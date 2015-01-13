module.exports = Command;

var BufferBuilder = require('buffer-builder');


/**
* Command object.
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
}

Command.prototype.getCommand = function() {
    return this._command;
}

Command.prototype.receivedData = function() {
    return this._receivedData;
}

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

Command.prototype.finish = function() {

    this._stdout = this._stdoutBufferBldr.get().toString('utf8').trim();
    this._stderr = this._stderrBufferBldr.get().toString('utf8').trim();

    this._stdoutBufferBldr = null;
    this._stderrBufferBldr = null;

    // done!
    this._completed = true;

    // invoke the callback
    if (this._callback) {
        this._callback(this._command, this._stdout, this._stderr);
    }
}

Command.prototype.getStdout = function() {
    return this._stdout;
}

Command.prototype.getStderr = function() {
    return this._stderr;
}

Command.prototype.isCompleted = function() {
    return this._completed;
}
