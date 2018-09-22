const {Bus, Device} = require('i2c-bus-promised');

// SSD1306
const OLED_WIDTH = 128;
const OLED_HEIGHT = 64;
const I2C_ADDRESS = 0x3c;
const I2C_MODE_CMD = 0x00;
const I2C_MODE_DATA = 0x40;
const CMD_SET_CONTRAST_CONTROL = 0x81;
const CMD_ENTIRE_DISPLAY_ON_RESET = 0xA4;
const CMD_ENTIRE_DISPLAY_ON = 0xA5;
const CMD_SET_NORMAL_DISPLAY = 0xA6;
const CMD_SET_INVERSE_DISPLAY = 0xA7;
const CMD_DISPLAY_OFF = 0xAE;
const CMD_DISPLAY_ON = 0xAF;
const CMD_SET_MEMORY_ADDRESSING_MODE = 0x20;
const CMD_SET_MEMORY_ADDRESSING_MODE_HORIZONTAL = 0b00;
const CMD_SET_MEMORY_ADDRESSING_MODE_VERTICAL = 0b01;
const CMD_SET_MEMORY_ADDRESSING_MODE_PAGE = 0b10;
const CMD_SET_COLUMN_ADDRESS = 0x21;
const CMD_SET_PAGE_ADDRESS = 0x22;

class OLED {

	constructor(bus) {
		this.device = new Device(bus, I2C_ADDRESS)
		this.updating = false;
	}

	async writeCommand(c) {
		return await this.device.writeByte(I2C_MODE_CMD, c);
	}

	async writeDataBlock(length, buffer) {
		return await this.device.writeI2cBlock(I2C_MODE_DATA, length, buffer);
	}

	async initialize() {
		await this.writeCommand(CMD_DISPLAY_OFF);
		// set lower column address
		await this.writeCommand(0x00);
		// set upper column address
		await this.writeCommand(0x10);
		// set display start line
		await this.writeCommand(0x40);
		// set page address
		await this.writeCommand(0xB0);
		// contrast control
		await this.writeCommand(CMD_SET_CONTRAST_CONTROL);
		await this.writeCommand(0xCF);
		// set segment remap
		await this.writeCommand(0xA1);
		// normal/reverse
		await this.writeCommand(CMD_SET_NORMAL_DISPLAY);
		// multiplex ratio
		await this.writeCommand(0xA8);
		await this.writeCommand(0x3F);
		// com scan direction
		await this.writeCommand(0xC8);
		// set display offset
		await this.writeCommand(0xD3);
		await this.writeCommand(0x00);
		// set osc division
		await this.writeCommand(0xD5);
		await this.writeCommand(0x80);
		// set pre-change period
		await this.writeCommand(0xD9);
		await this.writeCommand(0xF1);
		// set COM pins
		await this.writeCommand(0xDA);
		await this.writeCommand(0x12);
		// set vcomh
		await this.writeCommand(0xDB);
		await this.writeCommand(0x40);
		// set charge pump enable
		await this.writeCommand(0x8D);
		await this.writeCommand(0x14);
		// display ON
		await this.writeCommand(CMD_DISPLAY_ON);
	}

	async setNormalDisplay() {
		await this.writeCommand(CMD_SET_NORMAL_DISPLAY);
	}

	async setInverseDisplay() {
		await this.writeCommand(CMD_SET_INVERSE_DISPLAY);
	}

	async setHorizontalMode() {
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE);
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE_HORIZONTAL);
	}

	async setVerticalMode() {
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE);
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE_VERTICAL);
	}

	// for Page Addressing Mode
	async setPageMode(lower, higher, start) {
		if (!lower) lower = 0;
		if (!higher) higher = 0;
		if (!start) start = 0;
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE);
		await this.writeCommand(CMD_SET_MEMORY_ADDRESSING_MODE_PAGE);
		await this.writeCommand(0b00000000 | (lower & 0b1111));
		await this.writeCommand(0b00010000 | (higher & 0b1111));
		await this.writeCommand(0b10110000 | (start & 0b111));
	}

	// for Horizontal/Vertical Addressing Mode
	async setColumnAddress(start, end) {
		if (!start) start = 0;
		if (!end) end = 127;
		await this.writeCommand(CMD_SET_COLUMN_ADDRESS);
		await this.writeCommand(start & 0x7f);
		await this.writeCommand(end & 0x7f);
	}

	// for Horizontal/Vertical Addressing Mode
	async setPageAddress(start, end) {
		if (!start) start = 0;
		if (!end) end = 7;
		await this.writeCommand(CMD_SET_PAGE_ADDRESS);
		await this.writeCommand(start & 0b111)
		await this.writeCommand(end & 0b111);
	}

	async clear() {
		console.log('clear');
		await this.writeCommand(CMD_DISPLAY_OFF);
		await this.setHorizontalMode();
		await this.setColumnAddress(0, 127);
		await this.setPageAddress(0, 7);
		const buffer = Buffer.alloc(32, 0);
		for (let sent = 0; sent < 1024; sent += 32) {
			await this.writeDataBlock(buffer.length, buffer);
		}
		await this.writeCommand(CMD_DISPLAY_ON);
	}

	async drawImage(imagedata) {
		await this.setHorizontalMode();
		await this.setColumnAddress(0, 127);
		await this.setPageAddress(0, 7);
		const array = this.packToGDDRAMFormat(imagedata);
		const buffer = Buffer.from(array.buffer);
		for (let sent = 0; sent < buffer.length; sent += 32) {
			const b = buffer.slice(sent, sent+32);
			const s = await this.writeDataBlock(b.length, b);
		}
	}

	packToGDDRAMFormat(imagedata) {
		const array = new Uint8Array(imagedata.height / 8 * imagedata.width);
		for (let y = 0, ym = imagedata.height; y < ym; y += 8) {
			for (let x = 0, xm = imagedata.width; x < xm; x++) {
				let byte = 0;
				for (let b = 0; b < 8; b++) {
					const i = ((y+b) * xm + x) * 4;
					const bit = imagedata.data[i] === 0 ? 0 : 1;
					byte |= bit<<b;
				}
				array[ (y / 8) * xm + x ] = byte;
			}
		}
		return array;
	}
}

this.OLED = OLED;
