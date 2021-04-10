import { workerData, parentPort } from 'worker_threads';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import SVGtoPDF from 'svg-to-pdfkit';
import { DOMParser } from 'xmldom';
import canvas from 'canvas';
import fetch from 'node-fetch';
import { Canvg, presets } from 'canvg';
import { Message } from './message.js';

class PageWriter {
	/** @type {any[]} */
	pages = [];
	writerIndex = 0;

	/**
	 * @param {PDFKit.PDFDocument} pdf
	 */
	constructor(pdf) {
		this.pdf = pdf;
	}

	/**
	 * @param {string} svgSrc
	 * @param {number} pageNr
	 * @param {number} pageIndex
	 */
	add(svgSrc, pageNr, pageIndex) {
		this.pages[pageIndex] = {
			src: svgSrc,
			pageNr: pageNr,
		};
		return this.wirteNext();
	}

	/**
	 * @param {any} pageNr
	 * @param {number} writerIndex
	 */
	notifyWriteUpdate(pageNr, writerIndex = this.writerIndex) {
		parentPort.postMessage(
			new Message('write', {
				page: pageNr,
				pageIndex: writerIndex - 1,
			})
		);
	}

	/**
	 * @param {string} message
	 * @param {any[]} args
	 */
	notifyError(message, ...args) {
		parentPort.postMessage(
			new Message('error', {
				message: message,
				args: args,
			})
		);
	}

	/**
	 * @returns {Promise<any>}
	 */
	async wirteNext() {
		const page = this.pages[this.writerIndex];
		if (page == null) return;

		// Free ram
		this.pages[this.writerIndex] = null;
		this.writerIndex++;
		const { src, pageNr } = page;
		this.pdf.addPage();

		if (!src) {
			this.notifyWriteUpdate(pageNr);
			return this.wirteNext();
		}

		try {
			SVGtoPDF(this.pdf, src, 0, 0);
		} catch (e) {
			this.notifyError(`Failed to convert page #${this.writerIndex}:${page}, using png fallback, %s`, e);
			try {
				const png = await svg2img(src, 909, 1286);
				this.pdf.image(png, 0, 0, { fit: [909, 1286] });
			} catch (e) {
				this.notifyError(`Failed to convert page #${this.writerIndex}:${page} to png: %s`, e);
			}
		}
		this.notifyWriteUpdate(pageNr);
		return this.wirteNext();
	}
}

const px2pt = 72 / 96;
const pdf = new PDFDocument({
	size: [909 * px2pt, 1286 * px2pt],
	autoFirstPage: false,
	info: {
		Title: workerData.info.title,
		Author: workerData.info.publisher,
		Keywords: workerData.info.sbnr,
	},
});

const writer = new PageWriter(pdf);
const filestream = pdf.pipe(fs.createWriteStream(workerData.file));
filestream.on('finish', () => {
	parentPort.postMessage(new Message('done'));
});

let queue = Promise.resolve();

parentPort.on('message', (m) => {
	switch (m.action) {
		case 'add':
			{
				const src = Buffer.from(m.data.src).toString('utf-8');
				queue = queue.then(() => writer.add(src, m.data.page, m.data.pageIndex));
			}
			break;
		case 'end':
			queue.then(() => {
				pdf.end();
			});
			break;
	}
});

/**
 * @param {string} svgSrc
 * @param {number} width
 * @param {number} height
 */
async function svg2img(svgSrc, width, height) {
	const preset = presets.node({
		DOMParser,
		canvas,
		fetch,
	});
	const cnv = preset.createCanvas(width, height);
	const ctx = cnv.getContext('2d');

	const v = Canvg.fromString(ctx, svgSrc, preset);
	await v.render();

	return cnv.toBuffer('image/png');
}
