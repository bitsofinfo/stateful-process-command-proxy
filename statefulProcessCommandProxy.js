module.exports = StatefulProcessCommandProxy;

var poolModule = require('generic-pool');
var ProcessProxy = require('./processProxy');
var Promise = require('promise');


function StatefulProcessCommandProxy(config) {

    this._poolConfig = config;

    this._logFunction = config.logFunction;

    // map of all process PIDs -> ProcessProxies
    this._pid2processMap = new Object();

    var self = this;

    this._pool = poolModule.Pool({

        name: config.name,

        create: function(callback) {
            var processProxy = null;

            try {
                self._log('info',"create new process: " + config.processCommand);
                processProxy = new ProcessProxy(config.processCommand,
                                                config.processArgs,
                                                config.processRetainMaxCmdHistory,
                                                config.processInvalidateOnRegex,
                                                config.processCwd,
                                                config.processEnvMap,
                                                config.processUid,
                                                config.processGid,
                                                config.logFunction);


                // initialize
                processProxy.initialize(config.initCommands)

                .then(function(cmdResults) {
                    self._log('info',"new process ready, initialization commands completed.");
                    self._pid2processMap[processProxy.getPid()] = processProxy; // register in our process map
                    callback(null, processProxy);

                }).catch(function(exception) {
                    self._log('error',"new process initialize threw error: " + exception);
                });

            } catch (exception) {
                self._log('error',"create: exception: " + exception);
                callback(exception, null);
            }
        },


        validate: function(processProxy) {
            if (config.validateFunction) {
                return config.validateFunction(processProxy);
            }
            return true;
        },


        destroy: function(processProxy) {

            try {
                processProxy.shutdown(config.preDestroyCommands)

                .then(function(cmdResults) {

                    // remove from our tracking...
                    delete self._pid2processMap[processProxy.getPid()];

                    if (cmdResults) {
                        for (var cmd in cmdResults) {
                            var cmdResult = cmdResults[cmd];
                            self._log('info',"process preDestroyCmd[" +
                            cmdResult.command + "] out:" + cmdResult.stdout +
                                " err:" + cmdResult.stderr);
                        }
                    }

                }).catch(function(error) {
                    self._log('error',"process destroy, error " +
                        "while shutting down ProcessProxy["+processProxy.getPid()+"]: " + error);

                });

            } catch (e) {
                self._log('error',"process destroy: preDestroyCommands[" +
                    config.preDestroyCommands + "] exception: " + e);
            }

        },

        // maximum number in the pool
        max: config.max,

        // optional. if you set this,
        // make sure to drain() (see step 3)
        min: config.min,

        // specifies how long a resource can
        // stay idle in pool before being removed
        idleTimeoutMillis: config.idleTimeoutMS,

        // logFunction it will be called with two parameters:
        // - log string
        // - log level ('verbose', 'info', 'warn', 'error')
        log: function(msg,level) {
            self._log(level,msg);
        }
    });



}

StatefulProcessCommandProxy.prototype._log = function(severity,msg) {
    if (this._logFunction) {
        this._logFunction(severity,"StatefulProcessCommandProxy " + msg);

    } else {
        console.log(severity.toUpperCase() + " StatefulProcessCommandProxy " + msg);
    }
}


StatefulProcessCommandProxy.prototype.getStatus = function() {

    var processPids = Object.keys(this._pid2processMap);
    var statuses = [];

    // iterate through known pids...
    // @see aquire/destroy hooks in pool config above
    for (var i=0; i < processPids.length; i++) {
        var processProxy = this._pid2processMap[processPids[i]];

        try {
            statuses.push(processProxy.getStatus());

        } catch(exception) {
            self._log('error', "getStatus[process:" +
                processProxy.getPid() + "]: error: " + e);
        }
    }

    return statuses;
}

StatefulProcessCommandProxy.prototype.shutdown = function() {
    var self = this;
    return new Promise(function(fulfill, reject) {
        self._pool.drain(function() {
            self._log('info',"shutting down all" +
                " pooled ProcessProxies...");
            self._pool.destroyAllNow();
            fulfill();
        });
    });
}

/**
* executeCommand - takes a raw command statement and returns a promise
*                  which fulfills/returns {command:cmd, stdout:xxxx, stderr:xxxxx}
*                  on reject gives and exception
*
**/
StatefulProcessCommandProxy.prototype.executeCommand = function(command) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        self._pool.acquire(function(error, processProxy) {

            if (error) {
                self._log('error', "executeCommand[" +
                    command + "]: error in acquire: " + error);

            } else {

                try {
                    processProxy.executeCommand(command)

                    .then(function(cmdResult) {

                        try {
                            fulfill(cmdResult);

                        } finally {
                            self._pool.release(processProxy);
                        }

                    }).catch(function(error) {
                        self._log('error',"executeCommand: [" +
                                        command + "] error: " + e);
                        self._pool.release(processProxy);
                        reject(error);
                    });

                } catch (e) {
                    self._log('error',"executeCommand[" +
                        command + "]: error: " + e);
                    self._pool.release(processProxy);
                }

            }
        })
    });

}


/**
* executeCommand - takes an array of raw command strings and returns promise
*                  to be fulfilled with a a hash
*                  of "command" -> {command:cmd, stdout:xxxx, stderr:xxxxx}
*
* @commands Array of raw command/shell statements to be executed
*
* @return Promise, on fulfill returns promise to be fulfilled with a
*                  hash of commands -> {stdout:xxxx, stderr:xxxxx}
*                  on reject returns an exception
*
**/
StatefulProcessCommandProxy.prototype.executeCommands = function(commands) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        self._pool.acquire(function(error, processProxy) {

            if (error) {
                self._log('error',"executeCommands: " +
                    "error in acquire: " + error);

            } else {

                try {
                    processProxy.executeCommands(commands)

                    .then(function(cmdResults) {

                        try {
                            fulfill(cmdResults);

                        } finally {
                            self._pool.release(processProxy);
                        }

                    }).catch(function(error) {
                        self._log('error',"executeCommands: [" +
                            commands + "] error: " + e);
                        self._pool.release(processProxy);
                        reject(error);
                    });

                } catch (e) {
                    self._log('error',"executeCommands: error: " + e);
                    self._pool.release(processProxy);
                }

            }
        })
    });
}
