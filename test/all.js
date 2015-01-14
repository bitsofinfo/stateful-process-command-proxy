var assert = require('assert');
var Promise = require('promise');
var fs = require('fs');

describe('test stateful-process-command-proxy', function() {

    it('Should spawn a pool of shells, do various tasks and shutdown', function(done) {

        this.timeout(10000);

        var Promise = require('promise');
        var StatefulProcessCommandProxy = require("..");
        var isWin = /^win/.test(process.platform);


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
                            }

                        }

,

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
                            }


                        }
                    }


        // chose the right config based on platform
        var config = (isWin ? configs['windows'] : configs['nix']);

        // configure our proxy/pool of processes
        var statefulProcessCommandProxy = new StatefulProcessCommandProxy(
            {
                name: "StatefulProcessCommandProxy",
                max: 1,
                min: 1,
                idleTimeoutMillis: 10000,
                log: false,

                processCommand: config.processCommand,
                processArgs:    config.processArgs,


                processRetainMaxCmdHistory : 10,
                processInvalidateOnRegex : {
                                            'any':['.*nomatch.*'],
                                            'stdout':['.*nomatch.*'],
                                            'stderr':['.*nomatch.*']
                                        },
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


                preDestroyCommands: config.destroyCommands

            });

        // invoke all test commands
        var promise = statefulProcessCommandProxy.executeCommands(Object.keys(config.testCommands));

        // when all commands are executed
        // lets assert them all
        promise.then(function(cmdResults) {

            // assert all commands, lookup the command
            // via the result, to get its asserter
            // then invoke the asserter passing the cmd result
            for (var key in cmdResults) {
                var command = cmdResults[key].command;
                var asserter = config.testCommands[command];
                asserter(cmdResults[key]);
            }

            // collect status
            console.log(JSON.stringify(statefulProcessCommandProxy.getStatus(),null,2));

            // shut it all down
            statefulProcessCommandProxy.shutdown()

                .then(function(result) {

                    setTimeout(function() {
                        assert(fs.existsSync('initCmd.txt'));
                        assert(fs.existsSync('destroyCmd.txt'));
                        fs.unlink("initCmd.txt");
                        fs.unlink("destroyCmd.txt");
                        done()
                    },1000);

                }).catch(function(err) {
                    console.log(err);
                });


        }).catch(function(exception) {
            done(exception);
        });


    });

});
