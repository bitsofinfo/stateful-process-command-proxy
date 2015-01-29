var assert = require('assert');
var Promise = require('promise');
var fs = require('fs');

var configs = {
    'windows': {
        'processCommand': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'processArgs': ['-Command', '-'],
        'initCommands': [
            'echo test > initCmd.txt'
        ],
        'destroyCommands': [
            'echo test > destroyCmd.txt'
        ],
        'testCommands': {
            'echo test1': function(cmdResult) { assert.equal('test1', cmdResult.stdout.trim()); },
            'dir .' : function(cmdResult) { assert(cmdResult.stdout.indexOf('initCmd.txt') != -1); },
            '$test1="testvar"' : function(cmdResult) { assert(true); },
            'echo $test1' : function(cmdResult) { assert.equal('testvar',cmdResult.stdout.trim()); },

            // note this one validates the processEnvMap value set @ StatefulProcessCommandProxy
            'echo $Env:testenvvar' : function(cmdResult) { assert.equal('value1',cmdResult.stdout.trim()); }
        },
        'autoInvalidationConfig': {
            'checkIntervalMS': 5000, // check every 5s
            'commands': [
                { 'command': '$INVALIDATION_VAR="iShouldSetupInvalidation"'},
                { 'command': 'echo $INVALIDATION_VAR',
                  'regexes': {
                    'any' : [ {'regex':'.*Invalid.*', 'flags':'i', 'invalidOn':'match'}]
                  }
                }
            ]
        }
    },

    'nix': {
        'processCommand': '/bin/bash',
        'processArgs': ['-s'],
        'initCommands': [
            'echo test > initCmd.txt'
        ],
        'destroyCommands': [
            'echo test > destroyCmd.txt'
        ],
        'testCommands': {
            'echo test1': function(cmdResult) { assert.equal('test1', cmdResult.stdout.trim()); },
            'ls .' : function(cmdResult) { assert(cmdResult.stdout.indexOf('initCmd.txt') != -1); },
            'TEST1=testvar' : function(cmdResult) { assert(true); },
            'echo $TEST1' : function(cmdResult) { assert.equal('testvar',cmdResult.stdout.trim()); },

            // note this one validates the processEnvMap value set @ StatefulProcessCommandProxy
            'echo $testenvvar' : function(cmdResult) { assert.equal('value1',cmdResult.stdout.trim()); }
        },
        'autoInvalidationConfig': {
            'checkIntervalMS': 5000, // check every 5s
            'commands': [
                { 'command': 'INVALIDATION_VAR=iShouldSetupInvalidation'},
                { 'command': 'echo $INVALIDATION_VAR',
                  'regexes': {
                    'any' : [ {'regex':'.*Invalid.*', 'flags':'i', 'invalidOn':'match'}]
                  }
                }
            ]
        }
    }
};

var doFinalTestRoutine = function(done,statefulProcessCommandProxy) {

    // collect status
    console.log(JSON.stringify(statefulProcessCommandProxy.getStatus(),null,2));

    // shut it all down
    statefulProcessCommandProxy.shutdown()

        .then(function(result) {
            setTimeout(function() {
                assert(fs.existsSync('initCmd.txt'));
                assert(fs.existsSync('destroyCmd.txt'));
                fs.unlinkSync("initCmd.txt");
                fs.unlinkSync("destroyCmd.txt");
                done()
            },1000);

        }).catch(function(err) {
            console.log("b");
            console.log(err);
            done(err);
        });
}


var getStatefulProcessCommandProxyForTests = function(config,max,min,
                                                       setAutoValidationConfig,
                                                       setWhitelistConfig) {

    var Promise = require('promise');
    var StatefulProcessCommandProxy = require("..");


    // configure our proxy/pool of processes
    return new StatefulProcessCommandProxy(
        {
            name: "StatefulProcessCommandProxy",
            max: max,
            min: min,
            idleTimeoutMillis: 10000,

            logFunction: function(severity,origin,msg) {
                console.log(severity.toUpperCase() + " " +origin+" "+ msg);
            },

            processCommand: config.processCommand,
            processArgs:    config.processArgs,


            processRetainMaxCmdHistory : 10,
            processInvalidateOnRegex : {
                'any':[{'regex':'.*nomatch.*'}],
                'stdout':[{'regex':'.*nomatch.*'}],
                'stderr':[{'regex':'.*nomatch.*', 'flags':'i'}]
            },

            processCmdBlacklistRegex: [ {'regex':'.*blacklisted.*'} ],

            processCmdWhitelistRegex: (setWhitelistConfig ? [ {'regex':'.*whitelisted.*'} ] : null),

            processCwd : null,
            processEnvMap : {"testenvvar":"value1"},
            processUid : null,
            processGid : null,

            initCommands: config.initCommands,

            validateFunction: function(processProxy) {
                var isValid = processProxy.isValid();
                if(!isValid) {
                    console.log("ProcessProxy.isValid() returns FALSE!");
                }
                return isValid;
            },


            preDestroyCommands: config.destroyCommands,

            autoInvalidationConfig: (setAutoValidationConfig ? config.autoInvalidationConfig : null)

        });
}

describe('core-test', function() {

    it('Spawn a pool of shells, invoke testCommands then shutdown', function(done) {

        this.timeout(10000);

        var isWin = /^win/.test(process.platform);

        // chose the right config based on platform
        var config = (isWin ? configs['windows'] : configs['nix']);

        var statefulProcessCommandProxy = getStatefulProcessCommandProxyForTests(config,1,1,false,false);

        // #1 invoke all test commands
        var promise = statefulProcessCommandProxy.executeCommands(Object.keys(config.testCommands));

        // when all commands are executed
        // lets assert them all
        promise.then(function(cmdResults) {

            // assert all commands, lookup the command
            // via the result, to get its asserter
            // then invoke the asserter passing the cmd result
            for (var i=0; i<cmdResults.length; i++) {
                var command = cmdResults[i].command;
                var asserter = config.testCommands[command];
                asserter(cmdResults[i]);
            }

            doFinalTestRoutine(done,statefulProcessCommandProxy);


        }).catch(function(exception) {
            statefulProcessCommandProxy.shutdown();
            done(exception);
        });


    });

});

describe('blacklist-test', function() {

    it('Spawn a pool of shells, fail invoking blacklisted command, then shutdown', function(done) {

        this.timeout(10000);

        var isWin = /^win/.test(process.platform);

        // chose the right config based on platform
        var config = (isWin ? configs['windows'] : configs['nix']);

        var statefulProcessCommandProxy = getStatefulProcessCommandProxyForTests(config,1,1,false,false);

        var promise = statefulProcessCommandProxy.executeCommand("echo 'some blacklisted command'")

        // when all commands are executed
        // lets assert them all
        promise.then(function(cmdResults) {

            // should NOT get here!
            assert.equal(true,false);

        }).catch(function(error) {

            // should get here!
            assert(error.message.indexOf("blacklisted") != -1);

            doFinalTestRoutine(done,statefulProcessCommandProxy);

        }).catch(function(exception) {
            statefulProcessCommandProxy.shutdown();
            done(exception);
        });


    });

});

describe('whitelist-test', function() {

  it('Spawn a pool of shells, fail invoking non-whitelisted command, then shutdown', function(done) {

    this.timeout(10000);

    var isWin = /^win/.test(process.platform);

    // chose the right config based on platform
    var config = (isWin ? configs['windows'] : configs['nix']);

    var statefulProcessCommandProxy = getStatefulProcessCommandProxyForTests(config,1,1,false,true);

    var promise = statefulProcessCommandProxy
                  .executeCommand("echo 'some non-white listed command'")

    // when all commands are executed
    // lets assert them all
    promise.then(function(cmdResults) {

      // should NOT get here!
      assert.equal(true,false);

    }).catch(function(error) {

      // should get here!
      assert(error.message.indexOf("whitelisted") != -1);

      doFinalTestRoutine(done,statefulProcessCommandProxy);

    }).catch(function(exception) {
      statefulProcessCommandProxy.shutdown();
      done(exception);
    });


  });

});


describe('auto-invalidation-test', function() {

    it('Spawn a pool of shells, test auto-invalidation, then shutdown', function(done) {

        this.timeout(15000);

        var isWin = /^win/.test(process.platform);

        // chose the right config based on platform
        var config = (isWin ? configs['windows'] : configs['nix']);

        var statefulProcessCommandProxy = getStatefulProcessCommandProxyForTests(config,2,2,true,false);

        // do some commands
        statefulProcessCommandProxy.executeCommand("echo 'hello'");
        statefulProcessCommandProxy.executeCommand("echo 'hello2'");

        // sometime between the last command and when this runs
        // the invalidation routine should have run invalidating
        // all in the pool
        setTimeout(function() {

            // all should be invalid...
            var statuses = statefulProcessCommandProxy.getStatus();
            for (var i=0; i<statuses.length; statuses++) {
                var status = statuses[i];
                assert.equal(false,status.isValid);
            }


            doFinalTestRoutine(done,statefulProcessCommandProxy);
        },10000);


    });

});
