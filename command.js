module.exports = Command;

var BufferBuilder = require('buffer-builder');


/**
* Command object.
*
* This simply keeps track of stdout/stderr
* for a given command, it is used by ProcessProxy
* and fed data via ProcessProxy._onData()
**/
function Command(command, callback) {
    this._callback = callback;
    this._command = command;
    this._stdoutBufferBldr = new BufferBuilder();
    this._stderrBufferBldr = new BufferBuilder();
    this._stdout = null;
    this._stderr = null;
    this._receivedData = false;
    this._completed = false;
    this._startedAt = new Date();
    this._finishedAt = null;
}

// return the actual command string
Command.prototype.getCommand = function() {
    return this._command;
}

// Determine if this command received any data
// on stdout or stderr
Command.prototype.receivedData = function() {
    return this._receivedData;
}

// Applies data from stdout or stderr to internal buffers
Command.prototype.handleData = function(type, data) {

    if (data) {

        if (type == 'stdout') {
            this._stdoutBufferBldr.appendString(data, 'utf8');

        } else {
            this._stderrBufferBldr.appendString(data, 'utf8');
        }

        this._receivedData = true;
    }
}

// Called by ProcessProxy._onData when a given command is completed
Command.prototype.finish = function() {

    this._stdout = this._stdoutBufferBldr.get().toString('utf8').trim();
    this._stderr = this._stderrBufferBldr.get().toString('utf8').trim();

    this._stdoutBufferBldr = null;
    this._stderrBufferBldr = null;

    // done!
    this._completed = true;
    this._finishedAt = new Date();

    // invoke the callback
    if (this._callback) {
        this._callback(this._command, this._stdout, this._stderr);
    }
}


// Return the timestamp when the Command was created
Command.prototype.getStartedAt = function() {
    return this._startedAt;
}

// Return the timestamp when the Command finished
Command.prototype.getFinishedAt = function() {
    return this._finishedAt;
}

Command.prototype.getStdout = function() {
    return this._stdout;
}

Command.prototype.getStderr = function() {
    return this._stderr;
}

// Determine if the commmands finish() method was invoked
Command.prototype.isCompleted = function() {
    return this._completed;
}
