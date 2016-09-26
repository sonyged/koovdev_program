/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 */

'use strict';
let debug = require('debug')('koovdev_program');

const KOOVDEV_PROGRAM_ERROR = 0xfc;

const PROGRAM_NO_ERROR = 0x00;
const PROGRAM_NOT_READY = 0x01;
const PROGRAM_ERASE_FAILURE = 0x02;
const PROGRAM_ENTER_FAILURE = 0x03;
const PROGRAM_RESIDUAL_FAILURE = 0x04;
const PROGRAM_FIRSTPAGE_FAILURE = 0x05;
const PROGRAM_EXIT_FAILURE = 0x06;
const PROGRAM_DISCONNECTED = 0x07;

const error_p = (err) => {
  if (!err)
    return false;
  if (typeof err === 'object')
    return !!err.error;
  return true;
};

const make_error = (tag, err) => {
  if (tag === PROGRAM_NO_ERROR)
    return err;
  const original_err = err;
  if (typeof err === 'string')
    err = { msg: err };
  if (typeof err !== 'object' || err === null)
    err = { msg: 'unknown error' };
  err.error = true;
  err.original_error = JSON.stringify(original_err);
  if (!err.error_code)
    err.error_code = ((KOOVDEV_PROGRAM_ERROR << 8) | tag) & 0xffff;
  return err;
};

const error = (tag, err, cb) => {
  return cb(make_error(tag, err));
};

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

function program_sketch(stk, buffer, callback, progress) {
  stk.on('ready', (err) => {
    debug('ready', err);
    if (err)                    // err is stk500v2 error
      return error(PROGRAM_NOT_READY, {
        msg: 'device not become ready',
        original_error: err
      }, callback);
    const exit = (tag, err, msg) => {
      stk.exitProgrammingMode((error2) => {
        debug('exit', error2);
        if (tag !== PROGRAM_NO_ERROR)
          return error(tag, { msg: msg, original_error: err }, callback);
        if (error2)             // error2 is stk500v2 error
          return error(PROGRAM_EXIT_FAILURE, {
            msg: 'failed to exit from programming mode',
            original_error: error2
          }, callback);
        return error(PROGRAM_NO_ERROR, null, callback);
      });
    };
    // do cool chip stuff in here
    stk.enterProgrammingMode((err) => {
      debug('enter', err);
      if (err)                  // err is stk500v2 error
        return error(PROGRAM_ENTER_FAILURE, {
          msg: 'failed to inter programing mode',
          original_error: err
        }, callback);
      stk.eraseChip((err) => {
        debug('erase', err);
        if (err)                // err is stk500v2 error
          return exit(PROGRAM_ERASE_FAILURE, err, 'failed to erase chip');
        stk.enterProgrammingMode((err) => {
          debug('enter', err);
          if (err)              // err is stk500v2 error
            return exit(PROGRAM_ENTER_FAILURE, err,
                        'failed to enter after erase');
          const pageSize = atmega2560.flash.pageSize;
          const appStart = 0x4000;
          const residStart = appStart + pageSize;
          const firstPage = buffer.slice(appStart, residStart);
          const residPages = buffer.slice(residStart);
          const residSize = residPages.length;
          debug('firstPage', firstPage);
          debug('resid', residPages);
          stk.writeFlash({ hex: residPages, offset: residStart }, (err) => {
            debug('writeFlash', err);
            if (err)            // err is stk500v2 error
              return exit(PROGRAM_RESIDUAL_FAILURE, err,
                          'failed to write residual pages');
            stk.writeFlash({ hex: firstPage, offset: appStart }, (err) => {
              debug('writeFlash(firstPage)', err);
              if (err)          // err is stk500v2 error
                return exit(PROGRAM_FIRSTPAGE_FAILURE, err,
                           'failed to write first page');
              return exit(PROGRAM_NO_ERROR, err, '');
            }, (v) => {
              v.stage = 'writing first page';
              /*
               * Fixup total and written as we already written
               * residual pages.
               */
              v.total += residSize;
              v.written += residSize;
              progress(v);
            });
          }, (v) => {
            v.stage = 'writing residual pages';
            v.total += pageSize; // We'll write the first page also.
            progress(v);
          });
        });
      });
    });
  });
}

const program_device = (device, buffer, callback, progress) => {
  const program = () => {
    const serial = device.program_serial();
    const options = {
      comm: serial,
      chip: atmega2560,
      frameless: false,
      debug: false
    };
    const stk500v2 = require('avrgirl-stk500v2');
    const stk = new stk500v2(options);
    program_sketch(stk, buffer, (err) => {
      device.close((close_err) => {
        if (error_p(err))
          return callback(err);
        return callback(close_err);
      });
    }, progress);
  };
  debug('program_sketch');
  device.reset_koov((err) => {
    debug('program_sketch: reset', err);
    if (error_p(err))
      return callback(err);
    device.serial_open((err) => {
      debug('program_sketch: open', err);
      if (error_p(err))
        return callback(err);
      device.serial_event('disconnect', (err) => {
        if (error_p(err))
          return callback(err);
        program();
      }, (err) => {
        debug('disconnect', err);
        return error(PROGRAM_DISCONNECTED, {msg: 'disconnected'}, callback);
      });
    });
  });
};

function Program(opts)
{
  this.device = opts.device;
  if (opts.debug)
    debug = opts.debug;
  this.program_sketch = (name, sketch, callback, progress) => {
    const intelhex = require('intel-hex');
    const buffer = intelhex.parse(sketch).data;
    debug('program_sketch', name, buffer.length);
    this.device.close(err => {
      debug('program_sketch: close', err);
      if (error_p(err))
        return callback(err);
      this.device.find_device(name, (err) => {
        debug('program_sketch: find', err);
        if (error_p(err))
          return callback(err);
        program_device(this.device, buffer, callback, progress);
      });
    });
  };
};

module.exports = {
  program: (opts) => { return new Program(opts); }
};
