import { Worker } from 'worker_threads';
import { Message } from './message.js';
import EventEmitter from 'events';

/**
 * @event Writer#write
 * @property {number} page
 * @property {number} pageIndex
 *
 * @event Writer#error
 * @property {string} message
 * @property {any[]} args
 *
 * @event Writer#done
 */
export class Writer extends EventEmitter {
	/** @type {Worker} */
	worker;
	/** @type {Promise<any>} */
	done;
	/**
	 * @param {string} file
	 * @param {import('../meta').MetaInfo} info
	 */
	constructor(file, info, workerFile = __dirname + '/worker-loader.js') {
		super();
		this.worker = new Worker(workerFile, {
			workerData: {
				file: file,
				info: info,
			},
		});

		this.worker.on('message', (value) => this._onMessage(value));

		this.done = new Promise((resolve) => {
			this.once('done', () => {
				resolve();
			});
		});
	}

	/**
	 * @private
	 * @param {Message} message
	 */
	_onMessage(message) {
		switch (message.action) {
			case 'write':
				this.emit('write', message.data);
				break;
			case 'error':
				this.emit('error', message.data);
				break;
			case 'done':
				this.emit('done');
				break;
			default:
				console.error('Unknown message action: %s', message.action);
				break;
		}
	}

	/**
	 * @param {Buffer} svgBuffer
	 * @param {Map<string, import('../util.js').BufferRange>} images Map of image link to buffer slice
	 * @param {Buffer} imageBuffer
	 * @param {number} pageIndex
	 * @param {number} pageNr
	 */
	write(svgBuffer, images, imageBuffer, pageIndex, pageNr) {
		this.worker.postMessage(
			new Message('add', {
				svgBuffer: svgBuffer,
				imageBuffer: imageBuffer,
				images: images,
				page: pageNr,
				pageIndex: pageIndex,
			}),
			[svgBuffer.buffer, imageBuffer.buffer]
		);
	}

	end() {
		this.worker.postMessage(new Message('end', null));
	}
}
