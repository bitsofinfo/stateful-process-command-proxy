module.exports = StatefulProcessCommandProxy;

var poolModule = require('generic-pool');
var ProcessProxy = require('./processProxy');
var Promise = require('promise');


function StatefulProcessCommandProxy(config) {

    this._pool = poolModule.Pool({

        name: config.name,

        create: function(callback) {
            var processProxy = null;

            try {
                console.log("StatefulProcessCommandProxy - create: " + config.processCommand);
                processProxy = new ProcessProxy(config.processCommand, config.processArgs);

                // initialize
                processProxy.initialize(config.initCommands)

                .then(function(cmdResults) {
                    console.log("ProcessProxy ready, initialization commands completed.");
                    callback(null, processProxy);

                }).catch(function(exception) {
                    console.log("ProcessProxy initialize threw error: " + exception);
                });

            } catch (exception) {
                console.log("ProcesProxyPool.create: exception: " + exception);
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

                    if (cmdResults) {
                        for (var cmd in cmdResults) {
                            var cmdResult = cmdResults[cmd];
                            console.log("StatefulProcessCommandProxy.preDestroyCmd[" +
                            cmdResult.command + "] out:" + cmdResult.stdout +
                            " err:" + cmdResult.stderr);
                        }
                    }

                }).catch(function(error) {
                    console.log("StatefulProcessCommandProxy.destroy, error " +
                    "while shutting down ProcessProxy: " + error);

                });

            } catch (e) {
                console.log("StatefulProcessCommandProxy.destroy: preDestroyCommands[" +
                config.preDestroyCommands + "]exception: " + e);
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

        // if true, logs via
        // console.log - can also be a function
        log: config.log
    });

}

StatefulProcessCommandProxy.prototype.shutdown = function() {
    var self = this;
    return new Promise(function(fulfill, reject) {
        self._pool.drain(function() {
            console.log("StatefulProcessCommandProxy is shutting down all " +
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
                console.log("StatefulProcessCommandProxy.executeCommand[" +
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
                        console.log("pool executeCommand: [" +
                        command + "] error: " + e);
                        self._pool.release(processProxy);
                        reject(error);
                    });

                } catch (e) {
                    console.log("StatefulProcessCommandProxy.executeCommand[" +
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
                console.log("StatefulProcessCommandProxy.executeCommands: " +
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
                        console.log("pool executeCommands: [" +
                        commands + "] error: " + e);
                        self._pool.release(processProxy);
                        reject(error);
                    });

                } catch (e) {
                    console.log("StatefulProcessCommandProxy.executeCommands: error: " + e);
                    self._pool.release(processProxy);
                }

            }
        })
    });
}
