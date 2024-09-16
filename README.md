# stateful-process-command-proxy
Node.js module for executing os commands against a pool of stateful, long-lived child processes such as bash shells or powershell consoles

[![Build Status](https://travis-ci.org/bitsofinfo/stateful-process-command-proxy.svg?branch=master)](https://travis-ci.org/bitsofinfo/stateful-process-command-proxy)

[![NPM](https://nodei.co/npm/stateful-process-command-proxy.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/stateful-process-command-proxy/)
[![NPM](https://nodei.co/npm-dl/stateful-process-command-proxy.png)](https://nodei.co/npm/stateful-process-command-proxy/)

This node module can be used for proxying long-lived bash process, windows console etc. It works and has been tested on both linux, os-x and windows hosts running the latest version of node.

* [Origin](#origin)
* [Features](#features)
* [Install & Tests](#install)
* [History](#history)
* [Usage](#usage)
* [Example](#example)
* [Security](#security)
* [Related Tools](#related)

### <a id="Origin"></a> Origin

This project originated out of the need to execute various Powershell commands (at fairly high volume and frequency) against services within Office365/Azure bridged via a custom node.js implemented REST API; this was due to the lack of certain features in the REST GraphAPI for Azure/o365, that are available only in Powershell.

If you have done any work with Powershell and o365, then you know that there is considerable overhead in both establishing a remote session and importing and downloading various needed cmdlets. This is an expensive operation and there is a lot of value in being able to keep this remote session open for longer periods of time rather than repeating this entire process for every single command that needs to be executed and then tearing everything down.

Simply doing an child_process.**exec** per command to launch an external process, run the command, and then killing the process is not really an option under such scenarios, as it is expensive and very singular in nature; no state can be maintained if need be. We also tried using [edge.js with powershell](https://github.com/tjanczuk/edge#how-to-script-powershell-in-a-nodejs-application) and this simply would not work with o365 exchange commands and heavy session cmdlet imports (the entire node.js process would crash). Using this module gives you full un-fettered access to the externally connected child_process, with no restrictions other than what uid/gid (permissions) the spawned process is running under (which you **really** have to consider from security standpoint!)

The diagram below should conceptually give you an idea of what this module does.

**The local user that the node process runs as should have virtually zero rights! Also be sure to properly configure a restricted UID/GID when instatiating a new instance of this. See security notes below.**

![Alt text](/diagram.png "Diagram1")

### <a id="features"></a> Features

* Works with any operating system that can run Node.js
* Tested w/ Bash and Powershell, and should work with virtually any other shell or interactive spawnable process which can be communicated with over STDIN, STDOUT, STDERR streams.
* Maintains a configurable pool of re-usable processes that are checked out/in when commands need to be executed
* Command whitelisting and blacklisting
* Definable list of "init" and "destroy" commands to be run as processes are created/destroyed
* Definable configuration for "auto-invalidation" of active processes
* Can be configured to maintain a "history" of commands run against each proxied process, useful for reporting or auditing purposes

### <a id="install"></a> Install & Tests

```
npm install stateful-process-command-proxy
```

```
npm install mocha
mocha test/all.js
```

### <a id="history"></a> History

```
v1.0.2 - 2024-09-16
    - Address #21 Fix slice cropping data output

v1.0.1 - 2016-11-10
    - Address #13 (force generic-pool 2.4.4)
    
v1.0.0 - 2016-06-08
    - Address #7 and #8 (regex w/ global flag reset, arguments in strict-mode)

v1.0-beta.8 - 2015-03-19
    - Address memory leaks

v1.0-beta.7 - 2015-02-05
    - Blacklist logging fix

v1.0-beta.6 - 2015-01-30
    - bug fixes, for auto-invalidation cmds being auto-whitelisted

v1.0-beta.5 - 2015-01-28
    - whitelisting fix

v1.0-beta.4 - 2015-01-28
    - New options for command whitelist regex matching
      Note new parameter order in ProcessProxy constructor!

    - Support for regex flags for all regex based configs

    - All regex pattern based configurations now must be objects
      in format {regex:'pattern' [,flags:'img etc']}

v1.0-beta.3 - 2015-01-26
    - New options for command blacklisting regex matching and interval
      based self auto-invalidation of ProcessProxy instances

v1.0-beta.2 - 2015-01-21
    - New return types for executeCommands - is now an array

v1.0-beta.1 - 2015-01-17
    - Initial version
```

### <a id="usage"></a> Usage

To use StatefulProcessCommandProxy the constructor takes one parameter which is a configuration object who's properties are described below. Please refer to the example (following) and the unit-test for more details.

```
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
                                         'stdout' : [ {regex:'regex1',flags:'m'}, ....],
                                         'stderr' : [ {regex:'regex1',flags:'ig'}, ....]
                                         }

   processCmdBlacklistRegex: optional config array regex patterns who if match the
                             command requested to be executed will be rejected
                             with an error. Blacklists run before whitelists

                                     [ {regex:'regex1',flags:'ig'},
                                       {regex:'regex2',flags:'ig'}...]

   processCmdWhitelistRegex: optional config array regex patterns defining commands
                             that are permitted to execute, if no match, the command
                             will be rejected. Whitelists run after blacklists

                                       [ {regex:'regex1',flags:'ig'},
                                         {regex:'regex2',flags:'ig'}...]

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
                       'any' :    [ {regex:'regex1', flags:'m', invalidOn:'match | noMatch'}, ....],
                       'stdout' : [ {regex:'regex1', flags:'ig', invalidOn:'match | noMatch'}, ....],
                       'stderr' : [ {regex:'regex1', flags:'i', invalidOn:'match | noMatch'}, ....]
                  }
              },...
            ]
       }
```

Its highly recommended you check out the unit-tests for some examples in addition to the below:

### <a id="example"></a> Example

Note this example is for a machine w/ bash in the typical location on *nix machines (i.e. linux or os-x). Windows (or other) can adjust the below as necessary to run their shell of choice, dos/powershell etc).

```
var Promise = require('promise');
var StatefulProcessCommandProxy = require("./");

var statefulProcessCommandProxy = new StatefulProcessCommandProxy(
    {
      name: "test",
      max: 2,
      min: 2,
      idleTimeoutMS: 10000,

      logFunction: function(severity,origin,msg) {
          console.log(severity.toUpperCase() + " " +origin+" "+ msg);
      },

      processCommand: '/bin/bash',
      processArgs:  ['-s'],
      processRetainMaxCmdHistory : 10,

      processInvalidateOnRegex :
          {
            'any':[{regex:'.*error.*',flags:'ig'}],
            'stdout':[{regex:'.*error.*',flags:'ig'}],
            'stderr':[{regex:'.*error.*',flags:'ig'}]
          },

      processCwd : './',
      processEnvMap : {"testEnvVar":"value1"},
      processUid : null,
      processGid : null,

      initCommands: [ 'testInitVar=test' ],

      validateFunction: function(processProxy) {
          return processProxy.isValid();
      },

      preDestroyCommands: [ 'echo This ProcessProxy is being destroyed!' ]
    });

// echo the value of our env variable set above in the constructor config
statefulProcessCommandProxy.executeCommand('echo testEnvVar')
  .then(function(cmdResult) {
      console.log("testEnvVar value: Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

// echo the value of our init command that was configured above
statefulProcessCommandProxy.executeCommand('echo testInitVar')
  .then(function(cmdResult) {
      console.log("testInitVar value: Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

// test that our invalidation regex above traps and destroys this process instance
statefulProcessCommandProxy.executeCommand('echo "this command has an error and will be '+
                ' destroyed after check-in because it matches our invalidation regex"')
  .then(function(cmdResult) {
      console.log("error test: Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

// set a var in the shell
statefulProcessCommandProxy.executeCommand('MY_VARIABLE=test1;echo MY_VARIABLE WAS JUST SET')
  .then(function(cmdResult) {
      console.log("Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

// echo it back
statefulProcessCommandProxy.executeCommand('echo $MY_VARIABLE')
  .then(function(cmdResult) {
      console.log("MY_VARIABLE value: Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

// shutdown the statefulProcessCommandProxy
// this is important and your destroy hooks will
// be called at this time.
setTimeout(function() {
  statefulProcessCommandProxy.shutdown();
},10000);

```

### <a id="security"></a> Security

Obviously this module can expose you to some insecure situations depending on how you use it... you are providing a gateway to an external process via Node on your host os! (likely a shell in most use-cases). Here are some tips; ultimately its your responsibility to secure your system.

* Read OWASPs article on command injection - https://www.owasp.org/index.php/Command_Injection
* Ensure that the node process is running as a user with very limited rights
* Make use of the uid/gid configuration appropriately to further limit the processes
* Make use of the whitelisted and blacklisted command configuration feature to mitigate your exposure
* Never expose calls to this module directly, instead you should write a wrapper layer around StatefulProcessCommandProxy that protects, analyzes and sanitizes external input that can materialize in a `command` statement. For an example of this kind of wrapper w/ sanitization of arguments see https://github.com/bitsofinfo/powershell-command-executor
* All commands you pass to `execute` should be sanitized to protect from injection attacks. The type of sanitization you do is up to you and is obviously different depending on what shell/process type you are mediating access to via this module.

### <a id="related"></a> Related Tools

Have a look at these related projects which build on top of this module to provide some higher level functionality

* https://github.com/bitsofinfo/io-event-reactor - Leverages `stateful-process-command-proxy` to execute shell commands in reaction to IO events
* https://github.com/bitsofinfo/powershell-command-executor - Introduces a higher level "registry" of powershell commands which can be generated, have arguments applied to them (and sanitized), then executed.
* https://github.com/bitsofinfo/powershell-command-executor-ui - Builds on top of powershell-command-executor to provide a simple Node REST API and AngularJS interface for testing the execution of commands in the registry
* https://github.com/bitsofinfo/meteor-shell-command-mgr - Small Meteor app that lets you manage/generate a command registry for powershell-command-executor
