'use strict';

// Load modules

const Http = require('http');
const Stream = require('stream');

const Symbols = require('./symbols');


// Declare internals

const internals = {};


exports = module.exports = internals.Response = class extends Http.ServerResponse {

    constructor(req, stream, onEnd) {

        super({ method: req.method, httpVersionMajor: 1, httpVersionMinor: 1 });

        this._shot = {
            headers: null,
            trailers: {},
            payloadChunks: stream ? null : [],
            stream: stream ? new internals.ResStream() : null
        };

        this._headers = {};      // This forces node@8 to always render the headers

        this.assignSocket(new internals.NullSocket());

        if (this._shot.stream !== null) {
            this._shot.stream.update(this, req);
        }

        this.once('finish', () => {

            if (this._shot.stream !== null) {
                this._shot.stream.update(this, req);
            }

            if (onEnd) {
                const res = internals.payload(this, req);
                onEnd(res);
            }
        });
    }

    writeHead() {

        const result = super.writeHead.apply(this, arguments);

        this._shot.headers = Object.assign({}, this._headers);       // Should be .getHeaders() since node v7.7

        // Add raw headers

        ['Date', 'Connection', 'Transfer-Encoding'].forEach((name) => {

            const regex = new RegExp('\\r\\n' + name + ': ([^\\r]*)\\r\\n');
            const field = this._header.match(regex);
            if (field) {
                this._shot.headers[name.toLowerCase()] = field[1];
            }
        });

        return result;
    }

    write(data, encoding, callback) {

        super.write(data, encoding, callback);

        if (this._shot.payloadChunks !== null) {
            this._shot.payloadChunks.push(new Buffer(data, encoding));
        }

        if (this._shot.stream !== null) {
            this._shot.stream.write(data, encoding);
        }

        return true;                                                    // Write always returns false when disconnected
    }

    end(data, encoding, callback) {

        if (data) {
            this.write(data, encoding);
        }

        if (this._shot.stream !== null) {
            this._shot.stream.end();
        }

        super.end(callback);
        this.emit('finish');
    }

    destroy() {

    }

    addTrailers(trailers) {

        for (const key in trailers) {
            this._shot.trailers[key.toLowerCase().trim()] = trailers[key].toString().trim();
        }
    }
};


internals.Response.prototype[Symbols.injection] = true;


internals.payload = function (response, req) {

    // Prepare response object

    const res = {
        raw: { req, res: response },
        headers: response._shot.headers,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        trailers: response._shot.trailers,
        rawPayload: null,
        payload: null
    };

    // Prepare payload

    if (response._shot.payloadChunks !== null) {
        const rawBuffer = Buffer.concat(response._shot.payloadChunks);
        res.rawPayload = rawBuffer;
        res.payload = rawBuffer.toString();
    }

    return res;
};

internals.ResStream = class ResStream extends Stream.PassThrough {

    update(response, req) {

        Object.assign(
            this,
            internals.payload(response, req),
            this.raw && { raw: this.raw }      // Don't override this.raw once set
        );
    }
};

// Throws away all written data to prevent response from buffering payload

internals.NullSocket = class NullSocket extends Stream.Writable {

    _write(chunk, encoding, callback) {

        setImmediate(callback);
    }
};
