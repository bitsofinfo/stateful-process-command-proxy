module.exports = StatefulProcessCommandProxy;

var poolModule = require('generic-pool');
var ProcessProxy = require('./processProxy');
var Promise = require('promise');

/**
* StatefulProcessCommandProxy is the gateway for executing commands
* for execution against an internal pool of stateful long-lived child_processes
* such as shells on the local system (i.e. powershell, bash etc)
*
* The config object takes the following object:

    name:           The name of this instance, arbitrary

    max:               maximum number of processes to maintain

    min:               minimum number of processes to maintain

    idleTimeoutMS:     idle in milliseconds by which a process will be destroyed

    processCommand: full path to the actual process to be spawned (i.e. /bin/bash)

    processArgs:    arguments to pass to the process command

    processRetainMaxCmdHistory: for each process spawned, the maximum number
                                of command history objects to retain in memory
                                (useful for debugging), default 0

    processInvalidateOnRegex: optional config of regex patterns who if match
                              their respective type, will flag the process as invalid

                                          {
                                         'any' :    [ {regex:'regex1',flags:'ig'}, ....],
                                         'stdout' : [ {regex:'regex1',flags:'ig'}, ....],
                                         'stderr' : [ {regex:'regex1',flags:'ig'}, ....]
                                         }

   processCmdBlacklistRegex: optional config array regex patterns who if match the
                             command requested to be executed will be rejected
                             with an error

                                     [ {regex:'regex1',flags:'ig'},
                                       {regex:'regex2',flags:'m'}...]

  processCmdWhitelistRegex: optional config array regex patterns who if do not match
                             the command requested it will be rejected
                             with an error

                             [ {regex:'regex1',flags:'ig'},
                               {regex:'regex2',flags:'m'}...]


    processCwd:    optional current working directory for the processes to be spawned

    processEnvMap: optional hash/object of key-value pairs for environment variables
                   to set for the spawned processes

    processUid:    optional uid to launch the processes as

    processGid:    optional gid to launch the processes as

    logFunction:    optional function that should have the signature
                    (severity,origin,message), where log messages will
                    be sent to. If null, logs will just go to console

    initCommands:   optional array of actual commands to execute on each newly
                    spawned ProcessProxy in the pool before it is made available

    preDestroyCommands: optional array of actual commands to execute on a process
                        before it is killed/destroyed on shutdown or being invalid

    validateFunction:  optional function that should have the signature to accept
                       a ProcessProxy object, and should return true/false if the
                       process is valid or not, at a minimum this should call
                       ProcessProxy.isValid(). If the function is not provided
                       the default behavior is to only check ProcessProxy.isValid()


    autoInvalidationConfig optional configuration that will run the specified
                           commands in the background on the given interval,
                           and if the given regexes match/do-not-match for each command the
                           ProcessProxy will be flagged as invalid and return FALSE
                           on calls to isValid(). The commands will be run in
                           order sequentially via executeCommands()

        {
           checkIntervalMS: 30000; // check every 30s
           commands:
              [
               { command:'cmd1toRun',

                 // OPTIONAL: because you can configure multiple commands
                 // where the first ones doe some prep, then the last one's
                 // output needs to be evaluated hence 'regexes'  may not
                 // always be present, (but your LAST command must have a
                 // regexes config to eval prior work, otherwise whats the point

                 regexes: {

                        // at least one key must be specified
                        // 'any' means either stdout or stderr
                        // for each regex, the 'on' property dictates
                        // if the process will be flagged invalid based
                        // on the results of the regex evaluation

                       'any' :    [ {regex:'regex1', flags:'im', invalidOn:'match | noMatch'}, ....],
                       'stdout' : [ {regex:'regex1', flags:'g', invalidOn:'match | noMatch'}, ....],
                       'stderr' : [ {regex:'regex1', flags:'i', invalidOn:'match | noMatch'}, ....]
                  }
              },...
            ]
       }
       windowsVerbatimArguments : optional boolean which, on win32 only, will prevent or allow parameter quoting (as defined in
                                  child_process.spawn() method)
                                  By default, this setting has value true (no escaping)

*
**/
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
                                                config.logFunction,
                                                config.processCmdBlacklistRegex,
                                                config.processCmdWhitelistRegex,
                                                config.autoInvalidationConfig,
                                                config.windowsVerbatimArguments);


                // initialize
                processProxy.initialize(config.initCommands)

                .then(function(cmdResults) {
                    self._log('info',"new process ready, initialization commands completed.");
                    self._pid2processMap[processProxy.getPid()] = processProxy; // register in our process map
                    callback(null, processProxy);

                }).catch(function(exception) {
                    self._log('error',"new process initialize threw error: " + exception + ' ' + exception.stack);
                });

            } catch (exception) {
                self._log('error',"create: exception: " + exception + ' ' + exception.stack);
                callback(exception, null);
            }
        },


        validate: function(processProxy) {
            if (config.validateFunction) {
                return config.validateFunction(processProxy);
            } else {
                return processProxy.isValid();
            }
        },


        destroy: function(processProxy) {

            try {
                processProxy.shutdown(config.preDestroyCommands)

                    .then(function(cmdResults) {

                        if (cmdResults) {
                            for (var i=0; i<cmdResults.length; i++) {
                                var cmdResult = cmdResults[i];
                                self._log('info',"process preDestroyCmd[" +
                                cmdResult.command + "] out:" + cmdResult.stdout +
                                    " err:" + cmdResult.stderr);
                            }
                        }

                    }).catch(function(error) {
                        self._log('error',"process destroy, error " +
                            "while shutting down ProcessProxy["+processProxy.getPid()+"]: " + error);

                    });


                // remove from our tracking...
                delete self._pid2processMap[processProxy.getPid()];

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
            self._log2(level,'Pool',msg);
        }
    });



}


StatefulProcessCommandProxy.prototype._log = function(severity,msg) {
    this._log2(severity,this.__proto__.constructor.name,msg);
}


StatefulProcessCommandProxy.prototype._log2 = function(severity,origin,msg) {
    if (this._logFunction) {
        this._logFunction(severity,origin,msg);

    } else {
        console.log(severity.toUpperCase() + " " + origin + " " + msg);
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
                processProxy.getPid() + "]: error: " + exception);
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

                var errMsg = "executeCommand[" +
                    command + "]: error in acquire: " + error +
                    ' ' + error.stack;

                self._log('error', errMsg);

                reject(new Error(errMsg));

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
                                            command + "] error: " + error);
                            self._pool.release(processProxy);
                            reject(error);
                        });

                } catch (e) {

                    var errMsg = "executeCommand[" +
                        command + "]: error: " + e;

                    self._log('error',errMsg);

                    self._pool.release(processProxy);

                    reject(new Error(errMsg));
                }

            }
        })
    });

}


/**
* executeCommand - takes an array of raw command strings and returns promise
*                  to be fulfilled with an array of cmdResults
*                  [
*                    {command:cmd1, stdout:xxxx, stderr:xxxxx},
*                    {command:cmd2, stdout:xxxx, stderr:xxxxx}
*                  ]
*
*
* @commands Array of raw command/shell statements to be executed
*
* @return Promise, on fulfill returns promise to be fulfilled with a
*                  array of cmdResults
*
**/
StatefulProcessCommandProxy.prototype.executeCommands = function(commands) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        self._pool.acquire(function(error, processProxy) {

            if (error) {
                var errMsg = "executeCommands: " +
                    "error in acquire: " + error + ' ' + error.stack;

                self._log('error',errMsg);

                reject(new Error(errMsg));

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
                                commands + "] error: " + error);
                            self._pool.release(processProxy);
                            reject(error);
                        });

                } catch (e) {
                    var errMsg = "executeCommands: error: " + e;

                    self._log('error',errMsg);
                    self._pool.release(processProxy);

                    reject(new Error(errMsg));
                }

            }
        })
    });
}
