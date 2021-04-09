const { workerData, parentPort } = require('worker_threads');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const SVGtoPDF = require('svg-to-pdfkit');
const { DOMParser } = require('xmldom');
const canvas = require('canvas');
const fetch = require('node-fetch');
const { Canvg, presets } = require('canvg');

class PageWriter {
	pages = [];
	writerIndex = 0;
	constructor(pdf) {
		this.pdf = pdf;
	}
	add(svgSrc, pageNr, pageIndex) {
		this.pages[pageIndex] = {
			src: svgSrc,
			pageNr: pageNr,
		};
		return this.wirteNext();
		return new Promise(async (res) => {
			for (let page; (page = this.pages[this.current]); this.current++) {
				let src = this.pages[this.writerIndex];
				// Free ram
				this.pages[this.writerIndex] = null;
				this.writerIndex++;

				this.pdf.addPage();
				if (src === true) {
					continue;
				}
				try {
					SVGtoPDF(this.pdf, src, 0, 0);
				} catch (e) {
					parentPort.postMessage({
						action: 'error',
						data: {
							message: `Failed to convert page #${this.writerIndex}:${page}, using png fallback, %s`,
							args: [e],
						},
					});
					await svg2img(src, 909, 1286)
						.then((png) => {
							this.pdf.image(png, 0, 0, { fit: [909, 1286] });
						})
						.catch((e) => {
							parentPort.postMessage({
								action: 'error',
								data: {
									message: `Failed to convert page #${this.writerIndex}:${page} to png: %s`,
									args: [e],
								},
							});
						});
				}
				parentPort.postMessage({ action: 'write', data: { page: page, pageIndex: this.writerIndex } });
			}
			res();
		});
	}

	notifyWriteUpdate(pageNr, writerIndex = this.writerIndex) {
		parentPort.postMessage({
			action: 'write',
			data: {
				page: pageNr,
				pageIndex: writerIndex,
			},
		});
	}

	notifyError(message, ...args) {
		parentPort.postMessage({
			action: 'error',
			data: {
				message: message,
				args: args,
			},
		});
	}

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
	parentPort.postMessage('done');
});

let queue = Promise.resolve();

parentPort.on('message', (m) => {
	switch (m.action) {
		case 'add':
			m.data.src = Buffer.from(m.data.src).toString('utf-8');
			queue = queue.then(() => writer.add(m.data.src, m.data.page, m.data.pageIndex));
			break;
		case 'end':
			queue.then(() => {
				console.log('Flushing pdf...');
				pdf.end();
				console.log(filestream.path);
			});
			break;
	}
});

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
