module.exports = ProcessProxy;

var fifo = require('fifo');
var Command = require('./command');
var spawn = require('child_process').spawn;
var Promise = require('promise');

var MARKER_DONE = '__done__';


// pending https://github.com/mafintosh/fifo/issues/2
// Added in fifo 2.0
/*
fifo.prototype.toArray = function () {
    var list = [];

    var n = this.node;
    var start = n;

    while(n != null) {
        list.push(n.value);

        if (n === start) {
            n = null;
        } else {
            n = n.next;
        }
    }

    return list;
}*/


/**
* ProcessProxy constructor
*
* @param processToSpawn full path to the process/shell to be launched
* @param arguments array of arguments for the process
*
* @param retainMaxCmdHistory optional, default 0; set to 0 to
*                            retain no command history, otherwise 1-N
*
* @param invalidateOnRegex optional regex pattern config object in the format:
*
*                           {
*                           'any' : ['regex1', ....],
*                           'stdout' : ['regex1', ....],
*                           'stderr' : ['regex1', ....]
*                           }
*
*                          where on Command.finish() if the regex matches the
*                          Command's output in the respective 'type'
*                          (where 'type' 'any' matches either stdout or stderr)
*                          will ensure that this ProcessProxies isValid()
*                          returns FALSE. Note that regex strings will be parsed
*                          into actual RegExp objects
*
* @param cwd optional current working directory path to launch the process in
* @param envMap optional hash of k/v pairs of environment variables
* @param uid optional uid for the process
* @param gid optional gid for the process
*
*
*/
function ProcessProxy(processToSpawn, arguments,
                      retainMaxCmdHistory, invalidateOnRegex,
                      cwd, envMap, uid, gid) {

    this._createdAt = new Date();
    this._processPid = null;
    this._processToSpawn = processToSpawn;
    this._processArguments = arguments;


    this._commandHistory = [];
    if(typeof(retainMaxCmdHistory)==='undefined') {
        this._retainMaxCmdHistory = 0;

    } else {
        this._retainMaxCmdHistory = retainMaxCmdHistory;
    }


    this._regexesMap = new Object();
    if(typeof(invalidateOnRegex)==='undefined') {
        // nothing to do...

    } else {

        this._invalidateOnRegexConfig = invalidateOnRegex;

        // build the _regexesMap from the config
        if (Object.keys(this._invalidateOnRegexConfig).length > 0) {

            var anyRegexes = this._invalidateOnRegexConfig['any'];
            var stdoutRegexes = this._invalidateOnRegexConfig['stdout'];
            var stderrRegexes = this._invalidateOnRegexConfig['stderr'];

            // where we will actually hold the parsed regexes
            var regexpsForStdout = []; // stdout + any
            var regexpsForStderr = []; // stderr + any

            this._regexesMap['stdout'] = regexpsForStdout;
            this._regexesMap['stderr'] = regexpsForStderr;

            this._parseRegexes(anyRegexes,[regexpsForStdout,regexpsForStderr]);
            this._parseRegexes(stdoutRegexes,[regexpsForStdout]);
            this._parseRegexes(stderrRegexes,[regexpsForStderr]);
        }
    }

    // if this process proxy is valid
    this._isValid = true;

    // options
    this._processOptions = new Object();

    if (cwd) {
        this._processOptions['cwd'] = cwd;
    }

    if (envMap) {
        this._processOptions['env'] = envMap;
    }

    if (uid) {
        this._processOptions['uid'] = uid;
    }

    if (gid) {
        this._processOptions['gid'] = gid;
    }

    this._commandStack = new fifo();

    this._commandStack.toArray();
};

ProcessProxy.prototype.getPid = function() {
    return this._processPid;
}

ProcessProxy.prototype._parseRegexes = function(regexesToParse, regexpsToAppendTo) {
    if (regexesToParse && regexesToParse.length > 0) {

        // parse all 'any' regexes to RegExp objects
        for (var i=0; i<regexesToParse.length; i++) {

            var regexStr = regexesToParse[i];
            try {
                var parsed = new RegExp(regexStr);
                for (var j=0; j<regexpsToAppendTo.length; j++) {
                    regexpsToAppendTo[j].push(parsed);
                }

            } catch(exception) {
                console.log("Error parsing invalidation regex: "
                    + regexStr + " err:"+exception);
            }
        }
    }
}


ProcessProxy.prototype.isValid = function() {
    return this._isValid;
}

/**
* _handleCommandFinished()
*   internal method that analyzes a just finish()ed command and
*   evaluates all process invalidation regexes against it
**/
ProcessProxy.prototype._handleCommandFinished = function(command) {
    if (command && command.isCompleted()) {

        // store command history...
        if (this._retainMaxCmdHistory > 0) {
            this._commandHistory.push(command); // append the latest one

            if (this._commandHistory.length >= this._retainMaxCmdHistory) {
                this._commandHistory.shift(); // get rid of the oldest one
            }
        }


        // not configured for regexe invalidation
        if(Object.keys(this._regexesMap).length == 0) {
            return;
        }

        var stdout = command.getStdout();
        var stderr = command.getStderr();

        var stdoutRegExps = this._regexesMap['stdout'];
        var stderrRegExps = this._regexesMap['stderr'];

        // check stderr first
        if (stderr && stderr.length > 0 && stderrRegExps.length > 0) {

            for (var i=0; i<stderrRegExps.length; i++) {
                var regexp = stderrRegExps[i];
                var result = regexp.exec(stderr);

                if (result) {
                    this._isValid = false;
                    console.log("ProcessProxy: stderr matches invalidation regex: "
                        + regexp.toString() + " stderr: " + stderr);
                    return; // exit!
                }
            }
        }

        // check stdout last
        if (stdout && stdout.length > 0 && stdoutRegExps.length > 0) {

            for (var i=0; i<stdoutRegExps.length; i++) {
                var regexp = stdoutRegExps[i];
                var result = regexp.exec(stdout);

                if (result) {
                    this._isValid = false;
                    console.log("ProcessProxy: stdout matches invalidation regex: "
                        + regexp.toString() + " stdout: " + stdout);
                    return; // exit!
                }
            }
        }
    }
}


/**
* onData()
*
* @param type [stdout | stderr]
* @param data Buffer
*
* This method handles the rules about reading the data Buffer generated by
* the child_process' stdout and stderr streams. The rule is pretty simple
* and assumes all commands executed run in the foreground, all commands
* written to stdin against the child_process are followed immediately by
* MARKER_DONE. When data prior to MARKER_DONE is encountered it is written
* to the first Command in the fifo stack. When MARKER_DONE is encountered
* the first element in the fifo stack is removed via a shift, and all data that follows
* the MARKER_DONE is written to the next "first" element in the fifo stack.
*
*
**/
ProcessProxy.prototype.onData = function(type, data) {

    var cmd = null;
    var dataToWrite = null;

    if (data) {

        // convert the buffer to a string and get the index of MARKER_DONE
        var dataStr = data.toString('utf8');
        var doneIdx = dataStr.indexOf(MARKER_DONE, 0);

        // no MARKER_DONE found? write all data to the first command
        // in the command stack
        if (doneIdx == -1) {

            cmd = this._commandStack.first();
            if (cmd) {
                cmd.handleData(type, data);
            }


        // MARKER DONE located...
        } else {

            var startIdx = 0;

            // while we continue to find MARKER_DONE text...
            while (doneIdx != -1) {

                // eject the first element in the stack
                cmd = this._commandStack.shift();

                // if there is no data to apply.... (DONE is first..)
                if (doneIdx == 0) {

                    // force the command to finish
                    if (cmd) {
                        cmd.finish();
                        this._handleCommandFinished(cmd);
                    }

                // there is data to apply
                } else {

                    // extract all data up-to the DONE marker...
                    var block = data.slice(startIdx, doneIdx - 1);

                    // apply the data and finish the command
                    if (cmd) {
                        cmd.handleData(type, block);
                        cmd.finish();
                        this._handleCommandFinished(cmd);
                    }

                }

                // determine the next "start" by which
                // we attempt to find the next DONE marker...
                startIdx = (doneIdx + MARKER_DONE.length);
                doneIdx = dataStr.indexOf(MARKER_DONE, startIdx);
            }

            // ok, no more DONE markers.. however we might
            // have data remaining after the marker in the buffer
            // that we need to apply to the "next" first command in the stack
            if (startIdx < data.length) {

                // get the command and apply
                cmd = this._commandStack.first();
                if (cmd) {
                    // slice off all remaining data and write it
                    var block = data.slice(startIdx);
                    cmd.handleData(type, block);
                }
            }

        }
    }
}

/**
* initialize() - initializes the ProcessProxy w/ optional initializtion commands
*                and returns a Promise, when fulfilled contains the results
*                of the initialization commands or on reject the exception
*
* initCommands - array of commands to execute after the process
*                is successfully spawned.
**/
ProcessProxy.prototype.initialize = function(initCommands) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        try {
            // spawn
            console.log("Spawning process: " + self._processToSpawn);
            self._process = spawn(self._processToSpawn, self._processArguments, self._processOptions);
            console.log("Process: " + self._processToSpawn +
                " PID: " + self._process.pid);

            self._processPid = self._process.pid;

            // register stdout stream handler
            self._process.stdout.on('data', function(data) {
                self.onData('stdout', data);
            });

            // register stderr stream handler
            self._process.stderr.on('data', function(data) {
                self.onData('stderr', data);
            });

            // register close handler
            self._process.on('close', function(code,signal) {
                console.log('child process received close; code:' + code + ' signal:'+signal);
            });

            // register error handler
            self._process.on('error', function(err) {
                console.log('child process received error ' + err);
            });

            // register exit handler
            self._process.on('exit', function(code, signal) {
                console.log('child process received exit; code:' + code + ' signal:'+signal);
            });


            // run all initCommands if provided
            if (initCommands) {

                self.executeCommands(initCommands)

                .then(function(cmdResults) {
                    fulfill(cmdResults); // invoke when done!

                }).catch(function(exception) {
                    console.log("initialize - initCommands, " +
                    "exception thrown: " + exception);
                    reject(exception);
                });


                // we are done, no init commands to run...
            } else {
                fulfill(null);
            }


        } catch (exception) {
            console.log("initialize, exception thrown: " + exception);
            reject(exception);
        }

    });


};

/**
* executeCommand - takes a raw command statement and returns a promise
*                  which fulfills/returns {command:cmd, stdout:xxxx, stderr:xxxxx}
*                  on reject gives an exception
*
**/
ProcessProxy.prototype.executeCommand = function(command) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        self.executeCommands([command])

        .then(function(cmdResults) {

            for (var cmd in cmdResults) {
                fulfill(cmdResults[cmd]);
            }

        }).catch(function(error) {
            reject(error);
        });

    });

};

/**
* executeCommands - takes an array of raw command strings and returns promise
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
ProcessProxy.prototype.executeCommands = function(commands) {

    self = this;

    return new Promise(function(fulfill, reject) {

        try {

            var cmdResults = new Object();

            for (var i = 0; i < commands.length; i++) {

                var command = commands[i];

                // push command to stack
                self._commandStack.push(

                    new Command(command,
                        function(cmd, stdout, stderr) {

                            cmdResults[cmd] = {
                                'command': cmd,
                                'stdout': stdout,
                                'stderr': stderr
                            };

                            if (Object.keys(cmdResults).length == commands.length) {
                                fulfill(cmdResults);
                            }

                        }));

                // write the command, followed by this echo
                // marker so we know that the command is done
                self._process.stdin.write(command + '\n' +
                'echo ' + MARKER_DONE + '\n');


            }

        } catch (e) {
            reject(e);
        }

    });

};

/**
* shutdown() - shuts down the ProcessProxy w/ optional shutdown commands
*              and returns a Promise, when fulfilled contains the results
*              of the shutdown commands or on reject the exception. No
*              matter what, (success or fail of shutdown commands), the actual
*              underlying child process being proxied WILL be KILLED.
*
* shutdownCommands - optional array of commands to execute before the process
*                is attempted to be shutdown.
**/
ProcessProxy.prototype.shutdown = function(shutdownCommands) {

    console.log(this._processToSpawn + " pid["+this._process.pid+"] is shutting down...");

    var self = this;

    return new Promise(function(fulfill, reject) {

        try {
            // run all shutdownCommands if provided
            if (shutdownCommands) {

                self.executeCommands(shutdownCommands)

                .then(function(cmdResults) {

                    self._process.stdin.end();
                    self._process.kill();

                    fulfill(cmdResults); // invoke when done!

                }).catch(function(exception) {
                    console.log("shutdown - shutdownCommands, " +
                    " exception thrown: " + exception);
                    self._process.stdin.end();
                    self._process.kill();
                    reject(exception);
                });


                // we are done, no init commands to run...
            } else {
                self._process.stdin.end();
                self._process.kill();
                fulfill(null);
            }


        } catch (exception) {
            console.log("shutdown, exception thrown: " + exception);
            self._process.stdin.end();
            self._process.kill();
            reject(exception);
        }
    });


};


/**
* Returns a status structure of this ProcessProxy
* at the point in time this method is invovked
*
**/
ProcessProxy.prototype.getStatus = function() {

    var status = {
        'statusTime':new Date().toISOString(),
        'pid':this._process.pid,
        'process':this._processToSpawn,
        'arguments':this._processArguments,
        'options':this._processOptions,
        'isValid':this._isValid,
        'createdAt':(this._createdAt ? this._createdAt.toISOString() : null),
        'invalidateOnRegexConfig':this._invalidateOnRegexConfig,
        'activeCommandStack':[],
        'commandHistory':[]
    };

    var commandStackArray = this._commandStack.toArray();
    for (var i=0; i<commandStackArray.length; i++) {
        var cmd  = commandStackArray[i];
        status['activeCommandStack'].push({
            'command':cmd.getCommand(),
            'startedAt':cmd.getStartedAt().toISOString(),
            'receivedData':cmd.receivedData(),
            'finishedAt':(cmd.getFinishedAt() ? cmd.getFinishedAt().toISOString() : null),
            'stdout':cmd.getStdout(),
            'stderr':cmd.getStderr()
        });
    }

    for (var i=0; i<this._commandHistory.length; i++) {
        var cmd  = this._commandHistory[i];
        status['commandHistory'].push({
                        'command':cmd.getCommand(),
                        'startedAt':cmd.getStartedAt().toISOString(),
                        'receivedData':cmd.receivedData(),
                        'finishedAt':(cmd.getFinishedAt() ? cmd.getFinishedAt().toISOString() : null),
                        'stdout':cmd.getStdout(),
                        'stderr':cmd.getStderr()
                    });
    }

    return status;



}
