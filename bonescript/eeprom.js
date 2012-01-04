// Functions derived from https://github.com/joyent/node/blob/master/lib/buffer.js are:
//
// Copyright Joyent, Inc. and other Node contributors. All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

var fs = require('fs');
var buffer = require('buffer');
var util = require('util');
bone = require('./bone').bone;

var debug = true;

// Function derived from https://github.com/joyent/node/blob/master/lib/buffer.js
if(!buffer.Buffer.prototype.readUint16BE) {
    buffer.Buffer.prototype.readUint16BE = function(offset) {
        var val = 0;
        val = this[offset] << 8;
        val |= this[offset + 1];
        return(val);
    };
}

// Function derived from https://github.com/joyent/node/blob/master/lib/buffer.js
if(!buffer.Buffer.prototype.hexSlice) {
    var toHex = function(n) {
        if (n < 16) return '0' + n.toString(16);
        return n.toString(16);
    }
    buffer.Buffer.prototype.hexSlice = function(start, end) {
        var len = this.length;
        if (!start || start < 0) start = 0;
        if (!end || end < 0 || end > len) end = len;

        var out = '';
        for (var i = start; i < end; i++) {
            out += toHex(this[i]);
        }
        return(out);
    };
}

// Function derived from https://github.com/joyent/node/blob/master/lib/buffer.js
if(!buffer.Buffer.prototype.writeUint16BE) {
    buffer.Buffer.prototype.writeUint16BE = function(value, offset) {
        this[offset] = (value & 0xff00) >>> 8;
        this[offset + 1] = value & 0x00ff;
    };
}

// Function derived from https://github.com/joyent/node/blob/master/lib/buffer.js
// fill(value, start=0, end=buffer.length)
if(!buffer.Buffer.prototype.fill) {
    buffer.Buffer.prototype.fill = function(value, start, end) {
    value || (value = 0);
    start || (start = 0);
    end || (end = this.length);

    if (typeof value === 'string') {
        value = value.charCodeAt(0);
    }
    if (!(typeof value === 'number') || isNaN(value)) {
        throw new Error('value is not a number');
    }

    if (end < start) throw new Error('end < start');

    // Fill 0 bytes; we're done
    if (end === start) return 0;
    if (this.length == 0) return 0;

    if (start < 0 || start >= this.length) {
        throw new Error('start out of bounds');
    }

    if (end < 0 || end > this.length) {
        throw new Error('end out of bounds');
    }

    return this.parent.fill(value,
                            start + this.offset,
                            end + this.offset);
    };
}

var eepromData = new buffer.Buffer(244);

var readEeproms = function() {
    var data = {};
    var addresses = [
        '/sys/bus/i2c/drivers/at24/3-0054/eeprom',
        '/sys/bus/i2c/drivers/at24/3-0055/eeprom',
        '/sys/bus/i2c/drivers/at24/3-0056/eeprom',
        '/sys/bus/i2c/drivers/at24/3-0057/eeprom',
        'eeprom-dump'
    ];
    var cape = null;
    var main = null;
    var raw = fetchEepromData('/sys/bus/i2c/drivers/at24/1-0050/eeprom');
    if(raw) {
        main = parseMainEeprom(raw);
    }
    if(main) {
        data.main = main;
    }
    for(var address in addresses) {
        raw = fetchEepromData(addresses[address]);
        if(raw) {
            cape = parseCapeEeprom(raw);
            if(cape) {
                data[addresses[address]] = cape;
            }
        }
    }
    return(data);
};

var fetchEepromData = function(address) {
    try {
        console.warn('Reading EEPROM at '+address);
        var eepromFile =
            fs.openSync(
                address,
                'r'
            );
        fs.readSync(eepromFile, eepromData, 0, 244, 0);
        return(eepromData);
    } catch(ex) {
        console.warn('Unable to open EEPROM at '+address+': '+ex);
        return(null);
    }
};

var parseMainEeprom = function(x) {
    var data = {};
    data.header = x.hexSlice(0, 4);
    if(data.header != 'aa5533ee') {
        console.error('Unknown EEPROM format: '+data.header);
        return(null);
    }
    data.boardName = x.toString('ascii', 4, 12).trim();
    data.version = x.toString('ascii', 12, 16).trim();
    data.serialNumber = x.toString('ascii', 16, 28).trim();
    data.configOption = x.hexSlice(28, 60);
    return(data);
};

var parseCapeEeprom = function(x) {
    var data = {};
    data.header = x.hexSlice(0, 4);
    if(data.header != 'aa5533ee') {
        console.error('Unknown EEPROM format: '+data.header);
        return(null);
    }
    data.formatRev = x.toString('ascii', 4, 6);
    if(data.formatRev != 'A0') {
        console.error('Unknown EEPROM format revision: '+data.formatRev);
        return(null);
    }
    data.boardName = x.toString('ascii', 6, 38).trim();
    data.version = x.toString('ascii', 38, 42).trim();
    data.manufacturer = x.toString('ascii', 42, 58).trim();
    data.partNumber = x.toString('ascii', 58, 74).trim();
    data.numPins = x.readUint16BE(74);
    data.serialNumber = x.toString('ascii', 76, 88).trim();
    data.currentVDD_3V3EXP = x.readUint16BE(236);
    data.currentVDD_5V = x.readUint16BE(238);
    data.currentSYS_5V = x.readUint16BE(240);
    data.DCSupplied = x.readUint16BE(242);
    data.mux = {};
    for(pin in bone) {
        if(bone[pin].eeprom) {
            var pinOffset = bone[pin].eeprom * 2 + 88;
            var pinData = x.readUint16BE(pinOffset);
            var pinObject = {};
            var used = (pinData & 0x8000) >> 15;
            if(used || debug) {
                pinObject.used = used ? 'used' : 'available';
                if(debug) pinObject.data = x.hexSlice(pinOffset, pinOffset+2);
                var direction = (pinData & 0x6000) >> 13;
                switch(direction) {
                case 1:
                    pinObject.direction = 'in';
                    break;
                case 2:
                    pinObject.direction = 'out';
                    break;
                case 3:
                    pinObject.direction = 'bidir';
                    break;
                case 0:
                default:
                    console.error('Unknown direction value: '+direction);
                }
                pinObject.slew = (pinData & 0x40) ? 'slow' : 'fast';
                pinObject.rx = (pinData & 0x20) ? 'enabled' : 'disabled';
                var pullup = (pinData & 0x18) >> 3;
                switch(pullup) {
                case 1:
                    pinObject.pullup = 'disabled';
                    break;
                case 2:
                    pinObject.pullup = 'pullup';
                    break;
                case 0:
                    pinObject.pullup = 'pulldown';
                    break;
                case 3:
                default:
                    console.error('Unknown pullup value: '+pullup);
                }
                pinObject.mode = (pinData & 0x0007);
                try {
                    // read mux from debugfs
                    var muxReadout= fs.readFileSync('/sys/kernel/debug/omap_mux/'+bone[pin].mux, 'ascii');
                    pinObject.function = muxReadout.split("\n")[2].split("|")[pinObject.mode].replace('signals:', '').trim();
                } catch(ex) {
                    console.warn('Unable to read pin mux function name: '+bone[pin].mux);
                }
                data.mux[pin] = pinObject;
            }
        }
    }
    return(data);
};

var fillEepromData = function(data) {
    eepromData.fill(0);
    eepromData.write('aa5533ee', 0, 4, encoding='hex');
    eepromData.write('A0', 4, 2);
    eepromData.write(data.boardName, 6, 32);
    eepromData.write(data.version, 38, 4);
    eepromData.write(data.manufacturer, 42, 16);
    eepromData.write(data.partNumber, 58, 16);
    eepromData.writeUint16BE(data.numPins, 74);
    eepromData.write(data.serialNumber, 76, 12);
    eepromData.writeUint16BE(data.currentVDD_3V3EXP, 236);
    eepromData.writeUint16BE(data.currentVDD_5V, 238);
    eepromData.writeUint16BE(data.currentSYS_5V, 240);
    eepromData.writeUint16BE(data.DCSupplied, 242);
    for(pin in data.mux) {
        if(bone[pin].eeprom) {
            var pinOffset = bone[pin].eeprom * 2 + 88;
            var pinObject = data.mux[pin];
            var pinData = 0;
	    if(pinObject.used == 'used') pinData |= 0x8000;
	    switch(pinObject.direction) {
            case 'in':
                pinData |= 0x2000;
                break;
            case 'out':
                pinData |= 0x4000;
                break;
            case 'bidir':
                pinData |= 0x6000;
                break;
            default:
                console.error('Unknown direction value: '+pinObject.direction);
            }
            if(pinObject.slew == 'fast') pinData |= 0x40;
            if(pinObject.rx == 'enabled') pinData |= 0x20;
            var pullup = (pinData & 0x18) >> 3;
            switch(pinObject.pullup) {
            case 'disabled':
                pinData |= 0x08;
                break;
            case 'pullup':
                pinData |= 0x10;
                break;
            case 'pulldown':
                break;
            default:
                console.error('Unknown pullup value: '+pullup);
            }
            pinData |= (pinObject.mode & 0x0007);
	    eepromData.writeUint16BE(pinData, pinOffset);
        }
    }
    return(eepromData);
};

var eeproms = readEeproms();
var eepromsString = util.inspect(eeproms, true, null);
console.log(eepromsString);
fs.writeFileSync('my-eeproms.json', eepromsString);
fillEepromData(eeproms['eeprom-dump'])
console.log(util.inspect(eepromData, true, null));
fs.writeFileSync('my-eeprom-dump', eepromData);
