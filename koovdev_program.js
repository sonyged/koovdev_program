/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 */

'use strict';
let debug = require('debug')('koovdev_program');

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
  stk.on('ready', (error) => {
    debug('ready', error);
    if (error)
      return callback(error);
    const exit = error => {
      stk.exitProgrammingMode((error2) => {
        debug('exit', error2);
        return callback(error || error2);
      });
    };
    // do cool chip stuff in here
    stk.enterProgrammingMode((error) => {
      debug('enter', error);
      if (error)
        return callback(error);
      stk.eraseChip((error) => {
        debug('erase', error);
        if (error)
          return exit(error);
        stk.enterProgrammingMode((error) => {
          debug('enter', error);
          if (error)
            return exit(error);
          const pageSize = atmega2560.flash.pageSize;
          const appStart = 0x4000;
          const residStart = appStart + pageSize;
          const firstPage = buffer.slice(appStart, residStart);
          const residPages = buffer.slice(residStart);
          const residSize = residPages.length;
          debug('firstPage', firstPage);
          debug('resid', residPages);
          stk.writeFlash({ hex: residPages, offset: residStart }, (error) => {
            debug('writeFlash', error);
            if (error)
              return exit(error);
            stk.writeFlash({ hex: firstPage, offset: appStart }, (error) => {
              debug('writeFlash(firstPage)', error);
              exit(error);
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
        callback(err || close_err);
      });
    }, progress);
  };
  debug('program_sketch');
  device.reset_koov((err) => {
    debug('program_sketch: reset', err);
    if (err)
      return callback(err);
    device.serial_open((err) => {
      debug('program_sketch: open', err);
      if (err)
        return callback(err);
      device.serial_event('disconnect', (err) => {
        if (err)
          return callback(err);
        program();
      }, (err) => {
        debug('disconnect', err);
        return callback({msg: 'disconnected'});
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
      if (err)
        return callback(err);
      this.device.find_device(name, (err) => {
        debug('program_sketch: find', err);
        if (err)
          return callback(err);
        program_device(this.device, buffer, callback, progress);
      });
    });
  };
};

module.exports = {
  program: (opts) => { return new Program(opts); }
};
