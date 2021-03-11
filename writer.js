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
	current = workerData.from;
	constructor(pdf) {
		this.pdf = pdf;
	}
	add(svgSrc, page) {
		this.pages[page] = svgSrc || true;
		return new Promise(async (res) => {
			for (let src; (src = this.pages[this.current]); this.current++) {
				this.pages[this.current] = null;
				this.pdf.addPage();
				if (src === true) {
					continue;
				}
				try {
					SVGtoPDF(this.pdf, src, 0, 0);
				} catch (e) {
					parentPort.postMessage({
						action: 'error',
						data: { message: `Failed to convert page ${this.current}, using png fallback, %s`, args: [e] },
					});
					await svg2img(src, 909, 1286)
						.then((png) => {
							this.pdf.image(png, 0, 0, { fit: [909, 1286] });
						})
						.catch((e) => {
							parentPort.postMessage({
								action: 'error',
								data: { message: `Failed to convert page ${this.current} to png: %s`, args: [e] },
							});
						});
				}
				parentPort.postMessage({ action: 'write', data: { page: this.current } });
			}
			res();
		});
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
			queue = queue.then(() => writer.add(m.data.src, m.data.page));
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
