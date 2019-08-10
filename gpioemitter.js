const EventEmitter = require('events');
const fs_ = require('fs');
const fs = fs_.promises;
fs.watch = fs_.watch;

class GPIOEventEmitter extends EventEmitter {
	constructor() {
		super();
		const interruptHandler = async (val, pin) => {
			const type = val === 0 ? 'keydown' : 'keyup';
			const name = 'F' + ((pin === 0) ? 1 : pin);
			this.emit(type, { type: type, key: name });
		};
		this.watchers = [];
		this.watchers.push(this.watchInterrupt(0, interruptHandler).catch((err) => console.error(err.message))); // F1
		this.watchers.push(this.watchInterrupt(2, interruptHandler).catch((err) => console.error(err.message))); // F2
		this.watchers.push(this.watchInterrupt(3, interruptHandler).catch((err) => console.error(err.message))); // F3
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
		await fs.writeFile(`/sys/class/gpio/export`, `${pin}`).catch((e) => {
			if(e.code !== 'EBUSY') {
				throw e;
			}
		});

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

this.GPIOEventEmitter = GPIOEventEmitter;
