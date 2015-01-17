# stateful-process-command-proxy
Node.js module for executing os commands against a pool of stateful, long-lived child processes such as bash or powershell

It is important to note, that despite the use-case described below for this project's origination, this node module can be used for proxying long-lived bash process (or any shell really) in addition to powershell etc. It works and has been tested on both *nix, osx and windows hosts running the latest version of node.

### Origin

This project originated out of the need to execute various Powershell commands (at fairly high volume and frequency) against services within Office365/Azure bridged via a custom node.js implemented REST API; this was due to the lack of certain features in the REST GraphAPI for Azure/o365, that are available only in Powershell. 

If you have done any work with Powershell and o365, then you know that there is considerable overhead in both establishing a remote session and importing and downloading various needed cmdlets. This is an expensive operation and there is a lot of value in being able to keep this remote session open for longer periods of time rather than repeating this entire process for every single command that needs to be executed and then tearing everything down.

Simply doing an child_process.**exec** per command to launch an external process, run the command, and then killing the process is not really an option under such scenarios, as it is expensive and very singular in nature; no state can be maintained if need be. We also tried using [edge.js with powershell](https://github.com/tjanczuk/edge#how-to-script-powershell-in-a-nodejs-application) and this simply would not work with o365 exchange commands and heavy session cmdlet imports (the entire node.js process would crash). Using this module gives you full un-fettered access to the externally connected child_process, with no restrictions other than what uid/gid (permissions) the spawned process is running under (which you **really** have to consider from security standpoint!)

The diagram below should conceptually give you an idea of what this module does. 

**The local user that the node process runs as should have virtually zero rights! Also be sure to properly configure a restricted UID/GID when instatiating a new instance of this**

![Alt text](/diagram.png "Diagram1")

### Usage

Its highly recommended you check out the unit-tests for some examples in addition to the below:


### Example
```
var Promise = require('promise');
var StatefulProcessCommandProxy = require("./");

var statefulProcessCommandProxy = new StatefulProcessCommandProxy(
    {
      name: "test",
      max: 1,
      min: 1,
      idleTimeoutMillis: 10000,

      logFunction: function(severity,origin,msg) {
          console.log(severity.toUpperCase() + " " +origin+" "+ msg);
      },

      processCommand: '/bin/bash',
      processArgs:  ['-s'],
      processRetainMaxCmdHistory : 10,

      processInvalidateOnRegex :
          {
            'any':['.*error.*'],
            'stdout':['.*error.*'],
            'stderr':['.*error.*']
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

statefulProcessCommandProxy.executeCommand('echo testEnvVar')
  .then(function(cmdResult) {
      console.log("testEnvVar value: Stdout: " + cmdResult.stdout);
  }).catch(function(error) {
      console.log("Error: " + error);
  });

statefulProcessCommandProxy.executeCommand('echo testInitVar')
  .then(function(cmdResult) {
      console.log("testInitVar value: Stdout: " + cmdResult.stdout);
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

setTimeout(function() {
  statefulProcessCommandProxy.shutdown();
},5000);

  ```
  
  
