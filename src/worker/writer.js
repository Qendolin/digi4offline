import { workerData, parentPort } from 'worker_threads';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import SVGtoPDF from 'svg-to-pdfkit';
import { DOMParser } from 'xmldom';
import canvas from 'canvas';
import fetch from 'node-fetch';
import { Canvg, presets } from 'canvg';
import { Message } from './message.js';

// https://chromium.googlesource.com/chromium/blink-public/+/refs/heads/master/default_100_percent/blink/broken_image.png
const brokenImageSrc =
	'iVBORw0KGgoAAAANSUhEUgAAAA4AAAAQCAYAAAAmlE46AAABh0lEQVQoU42QSS9DURiGv7VfhKWEnyA2' +
	'WFizsLciJGrowDVU55VIjE3sxFhB1ZDiVlUapYYguLRor9f5DrdRuaJv8izOOc+zORQIBFAKRFRGP+f3' +
	'B6BlP/CYMecpo0NRFLBXFPt8fpzf6ThO50xJ3rzLkMduIfZ6vTi51hE5fZMYM85q6rUQ8tiXsdvtQfxK' +
	'x3biFb/Hd0citNlsRXBDLpdbhmbbimcRiWu4uMvhXstL+D+4IadzDPFLHRvHL6aETzLYT2ZxcPZF6lYH' +
	'NzQ66kQsnUdIfS4Jdrmh4eERqOKwdqiVBLuiIVKUIagXeaxEtQLL0UfMRKII7sSK7hnhckM0OKjgSISL' +
	'ew8ST2getePlqJuskDTPNWI2rBrvJFxuiByOARye57Gw+wDbklfIlYXIoH6yChObERIOCVc2ZLc7ZOha' +
	'DZpG31DDVDXNhRMcghuyWu1YT6TROF3zZ2TQEmxCNPUObqi/34q2hdZ/I+Oud60HvdY+UGdnF9rbO8yg' +
	'HxS9dVss+AQqZY47NSC2iwAAAABJRU5ErkJggg==';

class PageWriter {
	/** @type {{svgSrc: string, imageBuffer: Buffer, images: Map<string, import('../util.js').Range>, pageNr: number}[]} */
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
	 * @param {Map<string, import('../util.js').Range>} images Map of image link to buffer slice
	 * @param {Buffer} imageBuffer
	 * @param {number} pageNr
	 * @param {number} pageIndex
	 */
	add(svgSrc, images, imageBuffer, pageNr, pageIndex) {
		this.pages[pageIndex] = {
			svgSrc: svgSrc,
			imageBuffer: imageBuffer,
			images: images,
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
		const { svgSrc, imageBuffer, images, pageNr } = page;
		this.pdf.addPage();

		if (!svgSrc) {
			this.notifyWriteUpdate(pageNr);
			return this.wirteNext();
		}

		try {
			SVGtoPDF(this.pdf, svgSrc, 0, 0, {
				fontCallback: (family, bold, italic, options, ...args) => {
					console.log('Font Callback: %s %s %s %o .', family, bold, italic, options, ...args);
				},
				imageCallback: (link) => {
					if (!images.has(link)) {
						console.error('Missing image on page %s: %s', pageNr, link);
						return `data:image/png;base64,${brokenImageSrc}`;
					}
					const range = images.get(link);
					return imageBuffer.slice(range.from, range.to);
				},
				documentCallback: (file, ...args) => {
					console.log('Document Callback: %o .', file, ...args);
					return file;
				},
				/*colorCallback: ([[r, g, b], a], raw, ...args) => {
					console.log('Color Callback: %s %s %s %s %s.', r, g, b, a, raw, ...args);
					return [[r, g, b], a];
				},*/
				warningCallback: (msg, ...args) => {
					console.log('Warning Callback: %s .', msg, ...args);
				},
			});
		} catch (e) {
			this.notifyError(`Failed to convert page #${this.writerIndex}:${page}, using png fallback, %s`, e);
			try {
				const png = await svg2img(svgSrc, 909, 1286);
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
				const svgSrc = Buffer.from(m.data.svgBuffer).toString('utf-8');
				const imageBuffer = Buffer.from(m.data.imageBuffer);
				queue = queue.then(() => writer.add(svgSrc, m.data.images, imageBuffer, m.data.page, m.data.pageIndex));
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
