module.exports = ProcessProxy;

var fifo = require('fifo');
var Command = require('./command');
var spawn = require('child_process').spawn;
var Promise = require('promise');

var MARKER_DONE = '__done__';


function ProcessProxy(processToSpawn, arguments) {
    this._processToSpawn = processToSpawn;
    this._processArguments = arguments;
    this._commandStack = new fifo();
};



ProcessProxy.prototype.onData = function(type, data) {

    var cmd = null;
    var dataToWrite = null;

    console.log("START");
    console.log(data.toString('utf8'));
    console.log("END");

    if (data) {

        var dataStr = data.toString('utf8');
        var doneIdx = dataStr.indexOf(MARKER_DONE, 0);

        if (doneIdx == -1) {

            cmd = this._commandStack.first();
            if (cmd) {
                cmd.handleData(type, data);
            }


        } else {

            var startIdx = 0;

            while (doneIdx != -1) {

                cmd = this._commandStack.shift();
                if (doneIdx == 0) {

                    if (cmd /* && cmd.receivedData()*/ ) {
                        cmd.finish();
                    }

                } else {

                    var block = data.slice(startIdx, doneIdx - 1);

                    if (cmd) {
                        cmd.handleData(type, block);
                        cmd.finish();
                    }

                }

                startIdx = (doneIdx + MARKER_DONE.length);
                doneIdx = dataStr.indexOf(MARKER_DONE, startIdx);
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
            self._process = spawn(self._processToSpawn, self._processArguments);
            console.log("Process: " + self._processToSpawn +
            " PID: " + self._process.pid);

            // register stdout stream handler
            self._process.stdout.on('data', function(data) {
                self.onData('stdout', data);
            });

            // register stderr stream handler
            self._process.stderr.on('data', function(data) {
                self.onData('stderr', data);
            });

            // register close handler
            self._process.on('close', function(code) {
                console.log('child process exited with code ' + code);
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

            console.log("Shutting down...");

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
