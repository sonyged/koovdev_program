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
const koovdev_program = require('koovdev_program').program({
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


const sketch = fs.readFileSync('./example/sketch_mar07b.cpp.hex');
const intelhex = require('intel-hex');
const buffer = intelhex.parse(sketch).data;

async.waterfall([
  (done) => {
    device.device_scan(done);
  },
  (done) => {
    device.list((list) => {
      console.log(list);
      return done();
    });
  },
  (done) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('ID? ', (id) => {
      console.log('ID:', id);
      rl.close();
      return done(null, parseInt(id));
    });
  },
  (id, done) => {
    const start = Date.now();
    koovdev_program.program_sketch({
      device: { id: id }, sketch: sketch, callback: (err) => {
        console.log('program_sketch', err, Date.now() - start);
        done();
      },
      progress: () => {}
    });
  }
]);
