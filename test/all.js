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


// ---------------------------------------------------------------------------
// auto-invalidation busy-guard tests
//
// These tests instantiate ProcessProxy directly without spawning a real child
// process, so they run quickly on any platform.  A short checkIntervalMS
// (200 ms) is used so we can observe multiple ticks within a sub-second wall
// clock budget.
// ---------------------------------------------------------------------------
describe('auto-invalidation-busy-guard-test', function() {

    var ProcessProxy = require('../processProxy');

    var AUTO_INVALIDATION_CONFIG = {
        checkIntervalMS: 200,
        commands: [
            {
                command: 'Get-ConnectionInformation',
                regexes: {
                    stdout: [ { regex: '.*ConnectionId.*', flags: 'i', invalidOn: 'noMatch' } ]
                }
            }
        ]
    };

    // Build a ProcessProxy with the busy-guard config but without spawning a
    // real process.  An optional logFn captures log output for assertions.
    function makeProxy(logFn) {
        var proxy = new ProcessProxy(
            '/bin/false',          // processToSpawn — never actually spawned
            [],                    // args
            0,                     // retainMaxCmdHistory
            undefined,             // invalidateOnRegex
            null,                  // cwd
            null,                  // envMap
            null,                  // uid
            null,                  // gid
            logFn || null,         // logFunction
            undefined,             // processCmdBlacklistRegex
            undefined,             // processCmdWhitelistRegex
            AUTO_INVALIDATION_CONFIG
        );

        // Stub out the child process so _executeCommands won't blow up if it
        // ever reaches stdin.write (it should not in the busy-guard tests).
        proxy._process   = { stdin: { write: function() {} }, pid: 999 };
        proxy._processPid = 999;

        return proxy;
    }

    // -----------------------------------------------------------------------
    // Test 1 — busy guard: _executeCommands is NOT called when stack has items
    // -----------------------------------------------------------------------
    it('skips _executeCommands when _commandStack is non-empty (busy guard)', function(done) {

        this.timeout(1000);

        var proxy = makeProxy();

        // Push a fake item so length > 0
        proxy._commandStack.push({ fake: true });

        var called = false;
        proxy._executeCommands = function() {
            called = true;
            return Promise.resolve([]);
        };

        proxy._initAutoInvalidation();

        // Wait past two full ticks to confirm _executeCommands is never invoked
        setTimeout(function() {
            clearInterval(proxy._autoInvalidationInterval);
            assert.equal(false, called, '_executeCommands should NOT have been called while stack is busy');
            done();
        }, 500);
    });

    // -----------------------------------------------------------------------
    // Test 2 — busy guard: skip message is logged and process stays valid
    // -----------------------------------------------------------------------
    it('logs skip message and leaves process valid when busy', function(done) {

        this.timeout(1000);

        var logMessages = [];
        var proxy = makeProxy(function(severity, origin, msg) {
            logMessages.push(msg);
        });

        proxy._commandStack.push({ fake: true });

        proxy._initAutoInvalidation();

        setTimeout(function() {
            clearInterval(proxy._autoInvalidationInterval);

            var found = logMessages.some(function(m) {
                return m.indexOf('Skipping auto-invalidation: process is busy') !== -1;
            });
            assert.equal(true, found, 'Expected "Skipping auto-invalidation: process is busy" in logs');
            assert.equal(true, proxy._isValid, 'Process should remain valid while busy');
            done();
        }, 500);
    });

    // -----------------------------------------------------------------------
    // Test 3 — busy guard: resumes on the next tick after the stack clears
    // -----------------------------------------------------------------------
    it('resumes _executeCommands on the next tick after stack clears', function(done) {

        this.timeout(1500);

        var callCount = 0;
        var proxy = makeProxy();

        // Busy on tick 1
        proxy._commandStack.push({ fake: true });

        proxy._executeCommands = function() {
            callCount++;
            return Promise.resolve([]);
        };

        proxy._initAutoInvalidation();

        // After tick 1 passes: assert still skipped, then clear the stack
        setTimeout(function() {
            assert.equal(0, callCount, '_executeCommands should not have been called on the busy tick');
            proxy._commandStack.shift();
        }, 300);

        // After tick 2 passes: assert executed at least once
        setTimeout(function() {
            clearInterval(proxy._autoInvalidationInterval);
            assert(callCount >= 1, '_executeCommands should have been called at least once after stack cleared');
            done();
        }, 700);
    });

});


// ---------------------------------------------------------------------------
// pool-limit-under-load-test
//
// One pool slot is pinned by a long-running command (sleep 8s) while 20 short
// "echo" commands are queued against the same pool.  The test verifies that:
//
//   1. The number of live pool processes never exceeds the configured max (2).
//   2. Every queued short command eventually completes without error.
//   3. All processes remain valid throughout — the auto-invalidation busy guard
//      (running every 2s) skips the occupied slot and does not corrupt the
//      process state while it is busy.
// ---------------------------------------------------------------------------
describe('pool-limit-under-load-test', function() {

    it('pool never exceeds max and all queued commands drain cleanly after long-running command', function(done) {

        this.timeout(40000);

        var isWin = /^win/.test(process.platform);
        var config = (isWin ? configs['windows'] : configs['nix']);

        var MAX_POOL = 2;

        // A command long enough to hold one pool slot across several
        // auto-invalidation ticks (8 s on nix, equivalent on Windows).
        var longCommand = isWin ? 'Start-Sleep -Seconds 8' : 'sleep 8';

        // Build a pool with auto-invalidation turned on so the busy guard fires
        // during the sleep.  The invalidation regex checks for 'alive' in stdout
        // and marks the process invalid only if it is NOT found — so a healthy
        // process running `echo alive` stays valid.
        var StatefulProcessCommandProxy = require('..');

        var statefulProcessCommandProxy = new StatefulProcessCommandProxy({
            name: 'StatefulProcessCommandProxy',
            max: MAX_POOL,
            min: MAX_POOL,
            idleTimeoutMS: 30000,

            logFunction: function(severity, origin, msg) {
                // Suppress generic-pool's high-volume availability logs
                if (msg.indexOf('_availableObjects') === -1) {
                    console.log(severity.toUpperCase() + ' pool-limit-test ' + msg);
                }
            },

            processCommand: config.processCommand,
            processArgs:    config.processArgs,

            processRetainMaxCmdHistory: 2,
            processInvalidateOnRegex: { any: [], stdout: [], stderr: [] },

            processCwd:    null,
            processEnvMap: null,
            processUid:    null,
            processGid:    null,

            initCommands: null,

            validateFunction: function(processProxy) {
                return processProxy.isValid();
            },

            preDestroyCommands: null,

            // Auto-invalidation fires every 2 s during the 8 s sleep (4 ticks).
            // The busy guard should skip every tick on the occupied process and
            // run normally on the idle one.
            autoInvalidationConfig: {
                checkIntervalMS: 2000,
                commands: [
                    {
                        command: isWin ? 'Write-Output alive' : 'echo alive',
                        regexes: {
                            stdout: [ { regex: 'alive', flags: 'i', invalidOn: 'noMatch' } ]
                        }
                    }
                ]
            }
        });

        var poolSizeViolations = [];
        var shortCommandResults = [];
        var commandErrors       = [];

        // ── Pin one pool slot with the long-running command ──────────────────
        statefulProcessCommandProxy.executeCommand(longCommand)
            .catch(function(err) { commandErrors.push(err); });

        // Give the long command ~300 ms to be acquired by the pool, then flood.
        setTimeout(function() {

            // ── Send 20 short commands against the (partially busy) pool ─────
            var pendingShort = [];
            for (var i = 0; i < 20; i++) {
                /* jshint loopfunc: true */
                pendingShort.push(
                    statefulProcessCommandProxy.executeCommand("echo 'cmd_" + i + "'")
                        .then(function(r) { shortCommandResults.push(r); })
                        .catch(function(err) { commandErrors.push(err); })
                );
            }

            // ── Poll pool size every 500 ms while commands are in flight ─────
            var checkInterval = setInterval(function() {
                var size = statefulProcessCommandProxy.getStatus().length;
                if (size > MAX_POOL) {
                    poolSizeViolations.push('size=' + size + ' @' + Date.now());
                }
            }, 500);

            // ── Wait for every short command to settle ────────────────────────
            Promise.all(pendingShort).then(function() {
                clearInterval(checkInterval);

                // 1. Pool never grew past the configured maximum
                assert.equal(
                    0,
                    poolSizeViolations.length,
                    'Pool exceeded max=' + MAX_POOL + ' during the test: ' + poolSizeViolations.join(', ')
                );

                // 2. No unexpected command errors
                assert.equal(
                    0,
                    commandErrors.length,
                    'Unexpected errors: ' + commandErrors.map(function(e) { return e.message; }).join('; ')
                );

                // 3. All 20 short commands returned a result
                assert.equal(
                    20,
                    shortCommandResults.length,
                    'Expected 20 short command results, got ' + shortCommandResults.length
                );

                // 4. Every process in the pool is still valid — the busy guard
                //    prevented auto-invalidation from corrupting the long-running
                //    process while it was occupied.
                var statuses = statefulProcessCommandProxy.getStatus();
                for (var j = 0; j < statuses.length; j++) {
                    assert.equal(
                        true,
                        statuses[j].isValid,
                        'Process pid=' + statuses[j].pid + ' should still be valid after test'
                    );
                }

                statefulProcessCommandProxy.shutdown()
                    .then(function() { done(); })
                    .catch(done);

            }).catch(function(err) {
                clearInterval(checkInterval);
                statefulProcessCommandProxy.shutdown();
                done(err);
            });

        }, 300);
    });

});
