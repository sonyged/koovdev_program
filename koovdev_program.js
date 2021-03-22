/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * 
 * Copyright (c) 2017 Sony Global Education, Inc.
 * 
 * Permission is hereby granted, free of charge, to any person
 * obtaining a copy of this software and associated documentation
 * files (the "Software"), to deal in the Software without
 * restriction, including without limitation the rights to use, copy,
 * modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
 * BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict';
let debug = require('debug')('koovdev_program');
const async = require('async');
const koovdev_error = require('koovdev_error');

const KOOVDEV_PROGRAM_ERROR = 0xfc;

const PROGRAM_NO_ERROR = 0x00;
const PROGRAM_NOT_READY = 0x01;
const PROGRAM_ERASE_FAILURE = 0x02;
const PROGRAM_ENTER_FAILURE = 0x03;
const PROGRAM_RESIDUAL_FAILURE = 0x04;
const PROGRAM_FIRSTPAGE_FAILURE = 0x05;
const PROGRAM_EXIT_FAILURE = 0x06;
const PROGRAM_DISCONNECTED = 0x07;
const PROGRAM_BTPIN_INVALID_OFFSET = 0x08;
const PROGRAM_BTPIN_INVALID_VALUE = 0x09;

const { error, error_p, make_error } = koovdev_error(KOOVDEV_PROGRAM_ERROR, [
  PROGRAM_NO_ERROR
]);

/*
 * Program sketch.
 */

/* Device parameter used to program sketch */
const atmega2560 = {
  "name": "ATmega2560",
  "timeout": 200,
  "stabDelay": 100,
  "cmdexeDelay": 25,
  "syncLoops": 32,
  "byteDelay": 0,
  "pollIndex": 3,
  "pollValue": 83,
  "pollMethod": 1,
  "preDelay": 1,
  "postDelay": 1,
  "pgmEnable": [172, 83, 0, 0],
  "erase": {
    "cmd": [172, 128, 0, 0],
    "delay": 9,
    "pollMethod": 0
  },
  "flash": {
    "write": [64, 76, 0],
    "read": [32, 0, 0],
    "mode": 65,
    "blockSize": 256,
    "delay": 10,
    "poll2": 0,
    "poll1": 0,
    "size": 262144,
    "pageSize": 256,
    "pages": 1024,
    "addressOffset": 1
  },
  "eeprom": {
    "write": [193, 194, 0],
    "read": [160, 0, 0],
    "mode": 65,
    "blockSize": 8,
    "delay": 10,
    "poll2": 0,
    "poll1": 0,
    "size": 4096,
    "pageSize": 8,
    "pages": 512,
    "addressOffset": 0
  },
  "sig": [30, 152, 1],
  "signature": {
    "size": 3,
    "startAddress": 0,
    "read": [48, 0, 0, 0]
  },
  "fuses": {
    "startAddress": 0,
    "write": {
      "low": [172, 160, 0, 0],
      "high": [172, 168, 0, 0],
      "ext": [172, 164, 0, 0]
    },
    "read": {
      "low": [80, 0, 0, 0],
      "high": [88, 8, 0, 0],
      "ext": [80, 8, 0, 0]
    }
  }
};

function program_sketch(stk, opts) {
  const { buffer, callback, progress, timeout, cleanups } = opts;
  const pageSize = atmega2560.flash.pageSize;
  const appStart = 0x4000;
  const residStart = appStart + pageSize;
  const firstPage = buffer.slice(appStart, residStart);
  const residPages = buffer.slice(residStart);
  const residSize = residPages.length;
  let exit = (err) => callback(err);
  const stk_call = (done, opts, cb) => {
    const { name: name, tag: tag, msg: msg } = opts;
    const error = (original_err, msg) => {
      const err = make_error(tag, { msg: msg, original_error: original_err });
      return done(error_p(err), err);
    };
    let tId = null;
    const updateTimeout = () => {
      tId = setTimeout(() => {
        debug(`${name}: timeout`);
        tId = null;
        return error(true, `${name}: timeout`);
      }, timeout || 60 * 1000);
    };
    const cancelTimeout = (cb) => {
      if (!tId)
        return;
      clearTimeout(tId);
      tId = null;
      return cb();
    };
    cleanups.program_sketch = () => {
      debug(`${name}: call cleanup`, tId);
      cancelTimeout(() => {
        debug(`${name}: call cleanup: done`);
      });
    };
    updateTimeout();
    cb((original_err) => {
      debug(`${name}`, original_err, tId);
      cancelTimeout(() => {
        if (original_err)       // original_err is stk500v2 error
          return error(original_err, msg);
        return done(null, null);
      });
    });
    return () => cancelTimeout(() => updateTimeout());
  };

  async.waterfall([
    (done) => {
      return stk_call(done, {
        name: 'ready',
        tag: PROGRAM_NOT_READY,
        msg: 'device not become ready'
      }, (cb) => {
        stk.on('ready', (original_err) => {
          if (!original_err) {  // original_err is stk500v2 error
            exit = (err) => {
              stk.exitProgrammingMode((err2) => {
                debug('exit', err2);
                if (!error_p(err) && err2) // err2 is stk500v2 error
                  err = make_error(PROGRAM_EXIT_FAILURE, {
                    msg: 'failed to exit from programming mode',
                    original_error: err2
                  });
                return callback(err);
              });
            };
          }
          return cb(original_err);
        });
      });
    },
    (err, done) => {
      return stk_call(done, {
        name: 'enter',
        tag: PROGRAM_ENTER_FAILURE,
        msg: 'failed to inter programing mode'
      }, cb => stk.enterProgrammingMode(cb));
    },
    (err, done) => {
      return stk_call(done, {
        name: 'erase',
        tag: PROGRAM_ERASE_FAILURE,
        msg: 'failed to erase chip',
      }, cb => stk.eraseChip(cb));
    },
    (err, done) => {
      return stk_call(done, {
        name: 'enter2',
        tag: PROGRAM_ENTER_FAILURE,
        msg: 'failed to enter after erase',
      }, cb => stk.enterProgrammingMode(cb));
    },
    (err, done) => {
      debug('firstPage', firstPage);
      debug('resid', residPages);
      const updateTimeout = stk_call(done, {
        name: 'residPages',
        tag: PROGRAM_RESIDUAL_FAILURE,
        msg: 'failed to write residual pages',
      }, cb => {
        stk.writeFlash({ hex: residPages, offset: residStart }, cb, (v) => {
          v.stage = 'writing residual pages';
          v.total += pageSize; // We'll write the first page also.
          progress(v);
          updateTimeout();
        });
      });
    },
    (err, done) => {
      const updateTimeout = stk_call(done, {
        name: 'firstPage',
        tag: PROGRAM_FIRSTPAGE_FAILURE,
        msg: 'failed to write first page',
      }, cb => {
        stk.writeFlash({ hex: firstPage, offset: appStart }, cb, (v) => {
          v.stage = 'writing first page';
          /*
           * Fixup total and written as we already written
           * residual pages.
           */
          v.total += residSize;
          v.written += residSize;
          progress(v);
          updateTimeout();
        });
      });
    }
  ], (_, err) => {
    return exit(error_p(err) ? err : make_error(PROGRAM_NO_ERROR, null));
  });
}

const program_device = (proxy, opts) => {
  const { buffer, callback, device, progress, timeout } = opts;
  let cleanups = { program_sketch: null };
  let cleanup = (err) => {
    cleanup = (err) => {
      debug('program_sketch: stray cleanup', err);
      return;
    };
    debug('program_sketch: cleanup called');
    if (cleanups.program_sketch)
      cleanups.program_sketch();
    proxy.close((close_err) => callback(error_p(err) ? err : close_err));
  };
  const program = (cleanups) => {
    const serial = proxy.program_serial();
    const options = {
      comm: serial,
      chip: atmega2560,
      frameless: false,
      debug: false
    };
    const stk500v2 = require('avrgirl-stk500v2');
    const stk = new stk500v2(options);
    program_sketch(stk, {
      buffer: buffer,
      callback: (err) => cleanup(err),
      progress: progress,
      timeout: timeout,
      cleanups: cleanups
    });
  };
  debug('program_sketch: start');
  async.waterfall([
    (done) => {
      proxy.reset_koov((err) => {
        debug('program_sketch: reset', err);
        return done(error_p(err), err);
      });
    },
    (_, done) => {
      proxy.rescan(null, device, ['win32', 'darwin'], (err, device) => {
        debug('program_sketch: rescan', err);
        return done(error_p(err), err);
      });
    },
    (_, done) => {
      proxy.serial_open((err) => {
        debug('program_sketch: open', err);
        return done(error_p(err), err);
      });
    },
    (_, done) => {
      proxy.serial_event('disconnect', (err) => {
        debug('program_sketch: set disconnect', err);
        return done(error_p(err), err);
      }, (err) => {
        debug('disconnect', err);
        cleanup(make_error(PROGRAM_DISCONNECTED, {
          msg: 'disconnected',
          original_error: err
        }));
      });
    },
  ], (_, err) => {
    if (error_p(err))
      return cleanup(err);
    return program(cleanups);
  });
};

function Program(opts)
{
  this.device = opts.device;
  if (opts.debug)
    debug = opts.debug;
  this.program_sketch = (opts) => {
    const { device, sketch, callback, progress, timeout, btpin } = opts;
    let { buffer } = opts;
    if (!buffer) {
      const intelhex = require('intel-hex');
      buffer = intelhex.parse(sketch).data;
    }
    debug('program_sketch', device, buffer.length, timeout, btpin);
    if (btpin) {
      if (!btpin.offset)
        return error(PROGRAM_BTPIN_INVALID_OFFSET, {
          msg: 'no btpin offset'
        }, callback);
      if (btpin.offset > buffer.length)
        return error(PROGRAM_BTPIN_INVALID_OFFSET, {
          msg: `offset out of range: ${btpin.offset} > ${buffer.length}`
        }, callback);
      if ((btpin.offset % 256) !== 0)
        return error(PROGRAM_BTPIN_INVALID_OFFSET, {
          msg: `offset not aligned: ${btpin.offset}`
        }, callback);
      if (!(btpin.value >= 0 && btpin.value <= 9999))
        return error(PROGRAM_BTPIN_INVALID_VALUE, {
          msg: `offset out of range: ${btpin.value}`
        }, callback);

      const embed_btpin = (buffer, btpin) => Buffer.from(buffer.map((v, i) => {
        if (i === btpin.offset)
          return btpin.value & 0xff;
        if (i === btpin.offset + 1)
          return (btpin.value >> 8) & 0xff;
        return v;
      }));
      buffer = embed_btpin(buffer, btpin);
    }
    async.waterfall([
      (done) => {
        this.device.close(err => {
          debug('program_sketch: close', err);
          return done(error_p(err), err);
        });
      },
      (_, done) => {
        this.device.find_device(device, (err) => {
          debug('program_sketch: find', err, device);
          return done(error_p(err), err);
        });
      },
      (_, done) => {
        program_device(this.device, {
          buffer: buffer,
          callback: err => {
            debug('program_sketch: program done', err);
            return done(error_p(err), err);
          },
          device,
          progress: progress,
          timeout: timeout
        });
      }
    ], (_, err) => {
      return callback(err);
    });
  };
};

module.exports = {
  program: (opts) => { return new Program(opts); }
};
