/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 */

'use strict';
const debug = require('debug')('example');
const fs = require('fs');

const async = require('async');

const device_proxy = require('device_proxy');
const ipc = { request: {}, reply: {} };
const opts = {
  sender: (to, what) => { return ipc.request[to](to, what); },
  listener: (to, cb) => {
    ipc.reply[to] = (event, arg) => { return cb(arg); };
  }
};

const device = device_proxy.client(opts);
const koovdev_action = require('koovdev_action').action({
  device: device
});
const koovdev_program = require('../koovdev_program.js').program({
  debug: debug,
  device: device
});

const koovdev_device = require('koovdev_device');
const server = device_proxy.server({
  listener: (from, handler) => {
    ipc.request[from] = (event, arg) => {
      return handler((to, what) => {
        return ipc.reply[to](to, what);
      }, arg);
    };
  },
  device: koovdev_device.device()
});


const sketch = fs.readFileSync('./example/locomotive.hex');
const intelhex = require('intel-hex');
const data = intelhex.parse(sketch).data;

const program = (len) => {
  console.log(`programming buffer of length: ${len}`);
  const zero = Buffer.alloc(len, 0);
  const buffer = Buffer.concat([data, zero]);
  //const buffer = data;
  async.waterfall([
    (done) => {
      device.device_scan(done);
    },
    (done) => {
      device.list((list) => {
        console.log(list.find(x => x.type === 'usb'));
        const id = list.find(x => x.type === 'usb').id;
        console.log(`id = ${id}`);
        return done(null, parseInt(id));
      });
    },
    (id, done) => {
      const start = Date.now();
      koovdev_program.program_sketch({
        device: { id: id }, buffer: buffer, callback: (err) => {
          console.log('program_sketch', err, Date.now() - start);
          done(err);
        },
        progress: () => {}
      });
    }
  ], (err, result) => {
    console.log(`done: err: ${err}, result: ${result}`);
    if (err)
      process.exit(1);
    if (len < 512)
      return setTimeout(() => program(len + 2), 2000);
    console.log(`all done`);
  });
};

program(2);
