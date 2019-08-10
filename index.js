//#!/usr/bin/env node


const EventEmitter = require('events');
const {Bus, Device} = require('i2c-bus-promised');
const Canvas = require('canvas');
const BDFFont = require('bdf-canvas').BDFFont;
const strftime = require('strftime');

const {OLED} = require('./oled.js');
const {GPIOEventEmitter} = require('./gpioemitter.js');

const fs_ = require('fs');
const fs = fs_.promises;
fs.createWriteStream = fs_.createWriteStream;

function wait(n) { return new Promise( (r) => setTimeout(r, n)) }

const WHITE = "#ffffff";
const BLACK = "#000000";

class Screen extends EventEmitter {
	get width() { return 128; }
	get height() { return 64; }

	constructor() {
		super();
		this.canvas = new Canvas(this.width, this.height);
		this.ctx = this.canvas.getContext("2d");
		this.ctx.fillStyle = BLACK;
		this.ctx.fillRect(0, 0, this.width, this.height);
		this.requests = [];
	}

	async init() {
		this.bus = new Bus(0);
		await this.bus.open();

		this.gpioEvent = new GPIOEventEmitter();
		const eventHandler = (e) => {
			this.emit(e.type, e, this.ctx);
		};
		this.gpioEvent.on('keydown', eventHandler);
		this.gpioEvent.on('keyup', eventHandler);

		this.oled = new OLED(this.bus);
		await this.oled.initialize();
		await this.oled.clear();
		this.emit("load", {}, this.ctx);
	}

	requestAnimationFrame(cb) {
		this.requests.push(cb);
	}

	async loop() {
		await this.init();
		let prevImageData = null;
		let lastRenderdTime = 0;
		const frames = 1000/30;
		for (;;) {
			for (let i = 0, len = this.requests.length; i < len; i++) {
				this.requests.shift()();
			}

			// render thread
			const imagedata = this.ctx.getImageData(0, 0, this.width, this.height);
			let   dirty = false;
			if (prevImageData) {
				const prev = prevImageData.data;
				const next = imagedata.data;
				const len  = next.length;
				for (let i = 0; i < len; i++) {
					if (prev[i] !== next[i]) {
						dirty = true;
						break;
					}
				}
			} else {
				dirty = true;
			}
			if (dirty) {
				await this.oled.drawImage(imagedata);
				prevImageData = imagedata;
			}
			const now = Date.now();
			const w = frames - (now - lastRenderdTime);
			if (w > 0) {
				await wait(w);
			}
			lastRenderdTime = now;
		}
	}

	clear() {
		const ctx = this.ctx;
		ctx.fillStyle = BLACK;
		ctx.fillRect(0, 0, this.width, this.height);
		ctx.fillStyle = WHITE;
	}
}
Screen.getInstance = () => {
	if (!Screen._instance) {
		Screen._instance = new Screen();
	}
	return Screen._instance;
};

const screen = Screen.getInstance();




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
	return new Promise( async (resolve, reject) => {
		const img = new Canvas.Image();
		img.onload = () => { resolve(img) };
		img.onerror = reject;
		img.src = await fs.readFile(path, null).catch((err) => reject(err));
	});
}


(async () => {
	const font = new BDFFont(await fs.readFile("./mplus_f10r.bdf", "utf-8"));
	const lines = [];
	const lineHeight = 12;
	function print(str) {
		lines.push(String(str));
		while (lines.length > 5) lines.shift();

		screen.clear();
		for (let i = 0; i < lines.length; i++) {
			font.drawText(screen.ctx, lines[i], 1, lineHeight*(i+1)-2);
		}
	}

	screen.on('load', async (e, ctx) => {
		console.log('load');
		screen.clear();

		/*
		print("init");
		for (let i = 0; i < 10; i++) {
			print(".....................")
			await wait(100);
		}

		await wait(3000);
		*/

		screen.clear();
		font.drawText(ctx, "init", 65, lineHeight*1-2);
		loadImage("./foo.jpg").then((img) => {
			ctx.drawImage(img, 0, 0, 64, 64);
			const id = convertToBinary(ctx, 0, 0, 64, 64);
			ctx.putImageData(id, 0, 0);
			return Promise.resolve();
		}).catch((err) => console.error(err.message));

		setInterval( () => {
			const now = new Date();
			screen.clear();
			ctx.save();
			ctx.scale(2, 2);
			font.drawText(screen.ctx, strftime("%Y-%m-%d", new Date()), 1, lineHeight*(1)-2);
			font.drawText(screen.ctx, strftime("%H:%M:%S", new Date()), 1, lineHeight*(2)-2);
			ctx.restore();
		}, 1000);
	});

	let i = 0;
	screen.on('keydown', (e, ctx) => {
		console.log(e);
		print(`${i++} ${e.key} ${e.type}`);
	});

	screen.on('keyup', (e, ctx) => {
		console.log(e);
		print(`${i++} ${e.key} ${e.type}`);
	});

})();
screen.loop();
