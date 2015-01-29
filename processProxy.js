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
*                           'any' :    [ {regex:'regex1',flags:'ig'}, ....],
*                           'stdout' : [ {regex:'regex1',flags:'ig'}, ....],
*                           'stderr' : [ {regex:'regex1',flags:'m'}, ....]
*                           }
*
*                          where on Command.finish() if the regex matches the
*                          Command's output in the respective 'type'
*                          (where 'type' 'any' matches either stdout or stderr)
*                          will ensure that this ProcessProxies isValid()
*                          returns FALSE. Note that regex strings will be parsed
*                          into actual RegExp objects
*
*
* @param cwd optional current working directory path to launch the process in
* @param envMap optional hash of k/v pairs of environment variables
* @param uid optional uid for the process
* @param gid optional gid for the process
* @param logFunction optional function that should have the signature
*                             (severity,origin,message), where log messages will
*                             be sent to. If null, logs will just go to console
*
* @param processCmdBlacklistRegex optional config array regex patterns who if match the
*                                command requested to be executed will be rejected
*                                with an error. Blacklisted commands are checked
*                                before whitelisted commands below
*
*                                [ '{regex:'regex1',flags:'ig'},
*                                   {regex:'regex2',flags:'m'}...]
*
* @param processCmdWhitelistRegex optional config array regex patterns who must match
*                                 the command requested to be executed otherwise
*                                 will be rejected with an error. Whitelisted commands
*                                 are checked AFTER blacklisted commands above...
*
*                                [ '{regex:'regex1',flags:'ig'},
*                                   {regex:'regex2',flags:'m'}...]
*
*
* @param autoInvalidationConfig optional configuration that will run the specified
*                             commands on the given interval, and if the given
*                             regexes match/do-not-match for each command the
*                             process will be flagged as invalid and return FALSE
*                             on calls to isValid(). The commands will be run in
*                             order sequentially via executeCommands()
*
*         {
*            checkIntervalMS: 30000; // check every 30s
*            commands:
*               [
*                { command:'cmd1toRun',
*
*                   // OPTIONAL: because you can configure multiple commands
*                   // where the first ones doe some prep, then the last one's
*                   // output needs to be evaluated hence 'regexes'  may not
*                   // always be present, (but your LAST command must have a
*                   // regexes config to eval prior work, otherwise whats the point)
*
*                  regexes: {
*                         // at least one key must be specified
*                         // 'any' means either stdout or stderr
*                         // for each regex, the 'on' property dictates
*                         // if the process will be flagged invalid based
*                         // on the results of the regex evaluation
*                        'any' :    [ {regex:'regex1', flags:'i', invalidOn:'match | noMatch'}, ....],
*                        'stdout' : [ {regex:'regex1', flags:'i', invalidOn:'match | noMatch'}, ....],
*                        'stderr' : [ {regex:'regex1', flags:'i', invalidOn:'match | noMatch'}, ....]
*                   }
*               },...
*             ]
*        }
*
*
*
*/
function ProcessProxy(processToSpawn, arguments,
                      retainMaxCmdHistory, invalidateOnRegex,
                      cwd, envMap, uid, gid, logFunction,
                      processCmdBlacklistRegex,
                      processCmdWhitelistRegex,
                      autoInvalidationConfig) {

    this._createdAt = new Date();
    this._processPid = null;
    this._processToSpawn = processToSpawn;
    this._processArguments = arguments;
    this._logFunction = logFunction;


    this._commandHistory = [];
    if(typeof(retainMaxCmdHistory)==='undefined') {
        this._retainMaxCmdHistory = 0;

    } else {
        this._retainMaxCmdHistory = retainMaxCmdHistory;
    }


    this._cmdBlacklistRegexes = []; // holds RegExp objs
    this._cmdBlacklistRegexesConfs = processCmdBlacklistRegex; // retains orig configs
    if (typeof(processCmdBlacklistRegex) == 'undefined') {
        // nothing to do
    } else {
        // parse them
        this._parseRegexes(processCmdBlacklistRegex,[this._cmdBlacklistRegexes]);
    }

    this._cmdWhitelistRegexes = []; // holds RegExp objs
    this._cmdWhitelistRegexesConfs = processCmdWhitelistRegex; // retains orig configs
    if (typeof(processCmdWhitelistRegex) == 'undefined') {
      // nothing to do
    } else {
      // parse them
      this._parseRegexes(processCmdWhitelistRegex,[this._cmdWhitelistRegexes]);
    }


    // auto invalidation config build
    this._buildAutoInvalidationConfig(autoInvalidationConfig);

    // build invalidation regexes map
    this._buildInvalidationRegexesMap(invalidateOnRegex);


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

// internal method to process the constructor's invalidateOnRegex param
ProcessProxy.prototype._buildInvalidationRegexesMap = function(invalidateOnRegex) {

    this._regexesMap = new Object();
    if(typeof(invalidateOnRegex)==='undefined' || !invalidateOnRegex) {
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
}

// internal method to process the constructor's autoInvalidationConfig param
ProcessProxy.prototype._buildAutoInvalidationConfig = function(autoInvalidationConfig) {

    this._autoInvalidationConfig = null;
    if(typeof(autoInvalidationConfig)==='undefined' || !autoInvalidationConfig) {
        // nothing to do...

    } else {
        this._autoInvalidationConfig = autoInvalidationConfig;

        // for each command conf, we need to parse and convert all
        // of the configured string regexes into Regexp objects
        for (var i=0; i<this._autoInvalidationConfig.commands.length; i++) {

            var cmdConf = this._autoInvalidationConfig.commands[i];

            // this is optional...
            if (typeof(cmdConf.regexes)!=='undefined') {
                this._parseRegexConfigs(cmdConf.regexes['any']);
                this._parseRegexConfigs(cmdConf.regexes['stdout']);
                this._parseRegexConfigs(cmdConf.regexes['stderr']);
            }

        }

    }
}


/**
* Internal log function that will automatically set origin = classname
*/
ProcessProxy.prototype._log = function(severity,msg) {
    this._log2(severity,this.__proto__.constructor.name+"["+this._processPid+"]",msg);
}

/**
* Internal log function, if no "logFunction" is defined will log to console
*/
ProcessProxy.prototype._log2 = function(severity,origin,msg) {
    if (this._logFunction) {
        this._logFunction(severity,origin,msg);

    } else {
        console.log(severity.toUpperCase() + " " +origin+ " " + msg);
    }
}

/**
* Return the PID of the child_process that was spawned.
**/
ProcessProxy.prototype.getPid = function() {
    return this._processPid;
}

/**
* Parses a set of String regular expressions into RegExp objects and
* adds each resulting RegExp object to each array in 'regexpsToAppendTo'
*
* @param regexesToParse array of raw regular expression strings
* @param regexpsToAppendTo and array of target arrays which will each have
*                          the parsed RegExps appended to them
**/
ProcessProxy.prototype._parseRegexes = function(regexesToParse, regexpsToAppendTo) {
    if (regexesToParse && regexesToParse.length > 0) {

        // parse all 'any' regexes to RegExp objects
        for (var i=0; i<regexesToParse.length; i++) {

            var regexConf = regexesToParse[i];
            try {
                var parsed = null;

                if (typeof(regexConf.flags) != 'undefined') {
                    parsed = new RegExp(regexConf.regex,regexConf.flags);
                } else {
                    parsed = new RegExp(regexConf.regex);
                }

                for (var j=0; j<regexpsToAppendTo.length; j++) {
                    regexpsToAppendTo[j].push(parsed);
                }

            } catch(exception) {
                this._log('error',"Error parsing invalidation regex: "
                    + JSON.stringify(regexConf) + " err:"+exception + ' ' + exception.stack);
            }
        }
    }
}

/**
* Parses a set of regexConfig objects in the format {regex:pattern] and
* converts the String regular expressions into RegExp objects.
*
* Those that cannot be parsed will be deleted (the regex property deleted)
*
* @param regexConfigsToConvert
**/
ProcessProxy.prototype._parseRegexConfigs = function(regexConfigsToConvert) {

    if (!regexConfigsToConvert) {
        return;
    }

    for (var j=0; j<regexConfigsToConvert.length; j++) {

        var regexConf = regexConfigsToConvert[j];

        try {

            if (typeof(regexConf.flags) != 'undefined') {
                parsed = new RegExp(regexConf.regex,regexConf.flags);
            } else {
                parsed = new RegExp(regexConf.regex);
            }

            regexConf.regExpObj = parsed; // set as obj

        } catch(exception) {
            this._log('error',"Error parsing regex: "
                + JSON.stringify(regexConf) + " err:"+exception + ' ' + exception.stack);
        }
    }
}


/**
* Return if this process is "valid" or not, valid meaning usable or ready
* to execute commands
**/
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
                    this._log('error',"ProcessProxy: stderr matches invalidation regex: "
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
                    this._log('error',"ProcessProxy: stdout matches invalidation regex: "
                        + regexp.toString() + " stdout: " + stdout);
                    return; // exit!
                }
            }
        }
    }
}

/**
* _commandIsBlacklisted(command)
*
* Checks to see if current command matches any of the command
* blacklist regexes
*
* Returns true if the command is blacklisted due to a match, false on no matches
*/
ProcessProxy.prototype._commandIsBlacklisted = function(command) {

    // no blacklist? then its not blacklisted
    if (this._cmdBlacklistRegexes.length == 0) {
        return false;
    }


    for (var i=0; i<this._cmdBlacklistRegexes.length; i++) {
        var regexp = this._cmdBlacklistRegexes[i];
        var result = regexp.exec(command);

        if (result) {
            this._log('error',"ProcessProxy: command matches blacklist regex: "
                + regexp.toString() + " command: " + command);
            return true; // exit!
        }
    }

    return false;
}

/**
* _commandIsWhitelisted(command)
*
* Checks to see if current command matches any of the command
* whitelist regexes
*
* Returns true if the command is whitelisted due to a match, false on no matches
*/
ProcessProxy.prototype._commandIsWhitelisted = function(command) {

    // no whitelist? then its whitelisted
    if (this._cmdWhitelistRegexes.length == 0) {
      return true;
    }

    for (var i=0; i<this._cmdWhitelistRegexes.length; i++) {
      var regexp = this._cmdWhitelistRegexes[i];
      var result = regexp.exec(command);

      if (result) {
        return true; // exit! command is whitelisted
      }
    }

    this._log('error',"ProcessProxy: command does not match any configured " +
            "whitelist regexes, command: " + command);
    return false;
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
*
* Returns a promise
*  - on fulfill the cmdResults from any initialize comamnds, otherwise fulfill(null)
*  - on reject, an Error object
**/
ProcessProxy.prototype.initialize = function(initCommands) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        try {
            // spawn
            self._log('info',"Spawning process: " + self._processToSpawn);
            self._process = spawn(self._processToSpawn, self._processArguments, self._processOptions);
            self._log('info',"Process: " + self._processToSpawn +
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
                self._log('info','child process received close; code:' + code + ' signal:'+signal);
            });

            // register error handler
            self._process.on('error', function(err) {
                self._log('error','child process received error ' + err);
                self._isValid = false; // set us to invalid
            });

            // register exit handler
            self._process.on('exit', function(code, signal) {
                self._log('info','child process received exit; code:' + code + ' signal:'+signal);
            });


            // run all initCommands if provided
            if (initCommands) {

                self._executeCommands(initCommands,false) // skip black/whitelists

                    .then(function(cmdResults) {

                        // init auto invalidation
                        self._initAutoInvalidation();

                        fulfill(cmdResults); // invoke when done!

                    }).catch(function(exception) {
                        self._log('error',"initialize - initCommands, " +
                            "exception thrown: " + exception);
                        this._isValid = false; // set ourself int invalid
                        reject(exception);
                    });


            // we are done, no init commands to run...
            } else {

                // init auto invalidation
                self._initAutoInvalidation();

                // we are done
                fulfill(null);
            }


        } catch (exception) {
            self._log('error',"initialize, exception thrown: "
                + exception + ' ' + exception.stack);
            reject(exception);
        }

    });


};


/**
* If autoInvalidationConfig was provided to the constructor
* here we setup the code that will run on the checkIntervalMS
*/
ProcessProxy.prototype._initAutoInvalidation = function() {
    if (this._autoInvalidationConfig) {

        this._log('info','Configuring auto-invalidation to run every '
            + this._autoInvalidationConfig.checkIntervalMS + "ms");

        var self = this;

        // the below will run on an interval
        setInterval(function() {

            // #1 build list of commands
            var commandsToExec = [];
            for(var i=0; i<self._autoInvalidationConfig.commands.length; i++) {
                var commandConfig = self._autoInvalidationConfig.commands[i];
                commandsToExec.push(commandConfig.command);
            }

            // #2 execute it
            self.executeCommands(commandsToExec)

                // #3 evaluate all results
                .then(function(cmdResults) {

                    // for each cmdResult evaluate the result against
                    // the corresponding commandConfig (they will be in
                    // the same order)
                    for (var i=0; i<cmdResults.length; i++) {

                        var cmdResult = cmdResults[i];
                        var cmdConfig = self._autoInvalidationConfig.commands[i];

                        if (!cmdConfig.hasOwnProperty('regexes')) {
                            continue;
                        }

                        if (self._evalRegexConfigs(cmdConfig.regexes['any'],cmdResult.stdout) ||
                            self._evalRegexConfigs(cmdConfig.regexes['any'],cmdResult.stderr) ||
                            self._evalRegexConfigs(cmdConfig.regexes['stdout'],cmdResult.stdout) ||
                            self._evalRegexConfigs(cmdConfig.regexes['stderr'],cmdResult.stderr)) {

                            self._log('warn','auto-invalidation determined '+
                                ' this ProcessProxy is invalid due to results' +
                                ' of command ['+cmdResult.command+'], see previous logs');

                            self._isValid = false;
                            break; // exit
                        }

                    }

                // handle any general execution error...
                }).catch(function(exception) {
                    self._log('error','Error in auto-invalidation interval run: '+
                        exception + ' ' + excetion.stack);
                });

        },this._autoInvalidationConfig.checkIntervalMS);
    }
}

/**
* Used by the interval function defined in _initAutoInvalidation() to
* evaluate an array of regexConfs against the 'dataToEval' string
* where a regexConf looks like
*
* {regex:'regex1', invalidOn:'match | noMatch'}
*
* returns TRUE or FALSE if any of the regex confs match the content
* according to their config described above.
*
*/
ProcessProxy.prototype._evalRegexConfigs = function(regexConfs, dataToEval) {

    // null? then false
    if (!regexConfs) {
        return false;
    }

    for (var i=0; i<regexConfs.length; i++) {
        var regexConf = regexConfs[i];

        if (regexConf.hasOwnProperty('regExpObj')) {
            var matches = regexConf.regExpObj.exec(dataToEval);

            if (matches && regexConf.invalidOn == 'match' ||
                !matches && regexConf.invalidOn == 'noMatch') {

                this._log('warn','auto-invalidation determined'+
                    ' command output ['+dataToEval+'] invalid using '+
                    'regex['+regexConf.regex+'] regexConf.invalidOn:'
                    +regexConf.invalidOn);

                return true;
            }
        }
    }

    return false;
}

/**
* executeCommand - takes a raw command statement and returns a promise
*                  which fulfills/returns {command:cmd, stdout:xxxx, stderr:xxxxx}
*                  on reject give an Error object
*
**/
ProcessProxy.prototype.executeCommand = function(command) {

    var self = this;

    return new Promise(function(fulfill, reject) {

        self.executeCommands([command])

        .then(function(cmdResults) {

            fulfill(cmdResults[0]);


        }).catch(function(error) {
            reject(error);
        });

    });

};

/**
* executeCommands - takes an array of raw command strings and returns promise
*                  to be fulfilled with a an array of
*                  of [
*                       {command:cmd1, stdout:xxxx, stderr:xxxxx},
*                       {command:cmd2, stdout:xxxx, stderr:xxxxx}
*                     ]
*
* @commands Array of raw command/shell statements to be executed
*
* @return Promise, on fulfill returns promise to be fulfilled with a
*                  array of command results as described above, on reject
*                  and Error object
*
**/
ProcessProxy.prototype.executeCommands = function(commands) {
    return this._executeCommands(commands,true);
}


  /**
  * Internal method only:
  *
  * executeCommands - takes an array of raw command strings and returns promise
  *                  to be fulfilled with a an array of
  *                  of [
  *                       {command:cmd1, stdout:xxxx, stderr:xxxxx},
  *                       {command:cmd2, stdout:xxxx, stderr:xxxxx}
  *                     ]
  *
  * @commands Array of raw command/shell statements to be executed
  * @enforceBlackWhitelists enforce white and blacklists
  *
  * @return Promise, on fulfill returns promise to be fulfilled with a
  *                  array of command results as described above, on reject
  *                  and Error object
  *
  **/
  ProcessProxy.prototype._executeCommands = function(commands, enforceBlackWhitelists) {

    self = this;

    return new Promise(function(fulfill, reject) {

        try {

            if (enforceBlackWhitelists) {

                // scan for blacklisted, and fail fast
                for (var i=0; i<commands.length; i++) {
                  var cmd = commands[i];
                  if (self._commandIsBlacklisted(cmd)) {
                    reject(new Error("Command cannot be executed as it matches a " +
                    "blacklist regex pattern, see logs: command: " + cmd));
                    return; // exit!
                  }
                }

                // scan for whitelisted, and fail fast
                for (var i=0; i<commands.length; i++) {
                  var cmd = commands[i];
                  if (!self._commandIsWhitelisted(cmd)) {
                    reject(new Error("Command cannot be executed it does not match " +
                    "our set of whitelisted commands, see logs: command: " + cmd));
                    return; // exit!
                  }
                }

            }


            var cmdResults = [];

            for (var i = 0; i < commands.length; i++) {

                var command = commands[i];

                // push command to stack
                self._commandStack.push(

                    new Command(command,
                        function(cmd, stdout, stderr) {

                            cmdResults.push({
                                  'command': cmd,
                                  'stdout': stdout,
                                  'stderr': stderr
                              });

                            if (cmdResults.length == commands.length) {
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
*                   is attempted to be shutdown. On fulfill will return cmdResults
*                   of all destroy commands (if configured), on reject and Error
**/
ProcessProxy.prototype.shutdown = function(shutdownCommands) {

    this._log('info',this._processToSpawn + " pid["+this._process.pid+"] is shutting down...");

    var self = this;

    return new Promise(function(fulfill, reject) {

        try {
            // run all shutdownCommands if provided
            if (shutdownCommands) {

                self._executeCommands(shutdownCommands,false) // skip black/whitelists

                .then(function(cmdResults) {

                    self._process.stdin.end();
                    self._process.kill();

                    fulfill(cmdResults); // invoke when done!

                }).catch(function(exception) {
                    self._log('error',"shutdown - shutdownCommands, " +
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
            self._log('error',"shutdown, exception thrown: " + exception);
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
        'cmdBlacklistRegexesConfs':this._cmdBlacklistRegexesConfs,
        'cmdWhitelistRegexesConfs':this._cmdWhitelistRegexesConfs,
        'invalidateOnRegexConfig':this._invalidateOnRegexConfig,
        'autoInvalidationConfig':this._autoInvalidationConfig,
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
