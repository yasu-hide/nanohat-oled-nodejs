//#!/usr/bin/env node


const {Bus, Device} = require('i2c-bus-promised');
const Canvas = require('canvas');
const BDFFont = require('bdf-canvas').BDFFont;
const EventEmitter = require('events');
const {OLED} = require('./oled.js');

function wait(n) { return new Promise( (r) => setTimeout(r, n)) }


class GPIOEventEmitter extends EventEmitter {
	constructor() {
		super();
		const interruptHandler = async (val, pin) => {
			const type = val === 0 ? 'keydown' : 'keyup';
			const name = 'F' + ((pin === 0) ? 1 : pin);
			this.emit(type, { type: type, key: name });
		};
		this.watchers = [];
		this.watchers.push(this.watchInterrupt(0, interruptHandler)); // F1
		this.watchers.push(this.watchInterrupt(2, interruptHandler)); // F2
		this.watchers.push(this.watchInterrupt(3, interruptHandler)); // F3
	}

	createEventQueue(events) {
		let callback = null;
		const queue = [];
		for (let type of events) {
			this.on(type, (e) => {
				queue.push([type, e]);
				if (callback) {
					callback();
					callback = null;
				}
			});
		}
		return {
			nextEvent: () => {
				if (queue.length) {
					return new Promise( (resolve) => {
						resolve(queue.shift());
					});
				} else {
					return new Promise( (resolve) =>  {
						callback = () => {
							resolve(queue.shift());
						};
					});
				}
			}
		};
	}

	async watchInterrupt(pin, func) {
		try {
			await fs.writeFile(`/sys/class/gpio/export`, `${pin}`);
		} catch (e) {
			if (e.code === 'EBUSY') {
				// ignore
			} else {
				throw e;
			}
		}
		await fs.writeFile(`/sys/class/gpio/gpio${pin}/direction`, 'in');
		await fs.writeFile(`/sys/class/gpio/gpio${pin}/edge`, 'both'); // falling raising both
		const fh = await fs.open(`/sys/class/gpio/gpio${pin}/value`, 'r');
		const buf = new Uint8Array(1);
		fh.read(buf, 0, 1, 0);
		const watcher = fs.watch(`/sys/class/gpio/gpio${pin}/value`, {}, (eventType, filename) => {
			if (eventType === "change") {
				fh.read(buf, 0, 1, 0);
				const val = buf[0]-48;
				func(val, pin);
			} else {
				// XXX
				console.log(`unchecked event "${eventType}" occured with "${filename}"`);
			}
		});
		return {
			close: async () => {
				watcher.close();
				fh.close();
				await fs.writeFile(`/sys/class/gpio/gpio${pin}/edge`, 'none');
			}
		};
	}
}

const fs_ = require('fs');
const fs = fs_.promises;
fs.watch = fs_.watch;
fs.createWriteStream = fs_.createWriteStream;

const gpioEvent = new GPIOEventEmitter();


function convertToBinary(ctx, x, y, w, h) {
	const imagedata = ctx.getImageData(x, y, w, h);
	const data = imagedata.data;
	// Conver to grayscale (use RED position for retaining pixel)
	for (let x = 0, xm = imagedata.width; x < xm; x++) {
		for (let y = 0, ym = imagedata.height; y < ym; y++) {
			const i = (y * xm + x) * 4;
			const r = data[i+0];
			const g = data[i+1];
			const b = data[i+2];
			const gray = 0.3 * r + 0.59 * g + 0.11 * b;
			data[i+0] = gray;
		}
	}
	// Floyd-Steinberg dithering
	let error = 0;
	const f7 = 7/16, f3 = 3/16, f5 = 5/16, f1 = 1/16;
	for (let y = 0, ym = imagedata.height; y < ym; y++) {
		for (let x = 0, xm = imagedata.width; x < xm; x++) {
			const i = (y * xm + x) * 4;
			const gray = data[i+0]; // get gray data from RED position (see above)
			const val  = gray < 127 ? 0 : 255; // quantize to binary
			data[i+0] = val;
			data[i+1] = val;
			data[i+2] = val;
			error = gray - val;
			data[((y+0) * xm + (x+1)) * 4] += f7 * error;
			data[((y+1) * xm + (x-1)) * 4] += f3 * error;
			data[((y+1) * xm + (x+0)) * 4] += f5 * error;
			data[((y+1) * xm + (x+1)) * 4] += f1 * error;
		}
	}
	return imagedata;
}

async function loadImage(path) {
	return await new Promise( async (resolve, reject) => {
		const img = new Canvas.Image();
		img.onload = () => { resolve(img) };
		img.onerror = reject;
		img.src = await fs.readFile(path, null);
	});
}


async function main() {
	const bus = new Bus(0);
	await bus.open();

	const oled = new OLED(bus);
	await oled.initialize();
	await oled.clear();

	const font = new BDFFont(await fs.readFile("./mplus_f10r.bdf", "utf-8"));

	// const WHITE = "rgb(130, 244, 248)";
	const WHITE = "#ffffff";
	const BLACK = "#000000";

	const canvas = new Canvas(128, 64);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = BLACK;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = WHITE;
	const lineHeight = 12;
	font.drawText(ctx, "123456789012345678901", 1, lineHeight*1-2);
	font.drawText(ctx, "123456789012345678901", 1, lineHeight*2-2);
	font.drawText(ctx, "123456789012345678901", 1, lineHeight*3-2);
	font.drawText(ctx, "123456789012345678901", 1, lineHeight*4-2);

	font.drawText(ctx, "OK         <        >", 1, 60);

	ctx.fillStyle = BLACK;
	ctx.fillRect(0, 0, 128, 64);

	ctx.fillStyle = WHITE;
	font.drawText(ctx, "init", 65, lineHeight*1-2);
	font.drawText(ctx, "2345678901", 65, lineHeight*2-2);
	font.drawText(ctx, "2345678901", 65, lineHeight*3-2);
	font.drawText(ctx, "2345678901", 65, lineHeight*4-2);
	font.drawText(ctx, "2345678901", 65, lineHeight*5-2);

	const img = await loadImage("./foo.jpg");
	ctx.drawImage(img, 0, 0, 64, 64);

	const id = convertToBinary(ctx, 0, 0, 64, 64);
	ctx.putImageData(id, 0, 0);

	await oled.drawImage(ctx.getImageData(0, 0, 128, 64));

	const eventHandler = (e) => {
		ctx.fillStyle = BLACK;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = WHITE;
		ctx.save();
		ctx.scale(2, 2);
		const lineHeight = 12;
		font.drawText(ctx, `${e.key} ${e.type}`, 1, lineHeight*1-2);
		ctx.restore();
	};

	gpioEvent.on('keydown', eventHandler);
	gpioEvent.on('keyup', eventHandler);

	for (;;) {
		// render thread
		await wait(1000/60);
		await oled.drawImage(ctx.getImageData(0, 0, 128, 64));
	}

//	const out = fs.createWriteStream('text.png')
//	const stream = canvas.pngStream();
//
//	stream.on('data', function(chunk){
//		out.write(chunk);
//	});
//
//	stream.on('end', function(){
//		console.log('saved png');
//	});
}

try {
	main();
} catch (e) {
	console.log(e);
}
