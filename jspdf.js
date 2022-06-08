import { jsPDF } from 'jspdf';
import 'svg2pdf.js';
import { JSDOM } from 'jsdom';
import fs from 'fs';

const doc = new jsPDF({ unit: 'pt', format: [210, 297] });
fix3127(doc);
doc.deletePage(1);

let currentPage = 0;

async function convertAll() {
	for (let i = 1; i <= 10; i++) {
		currentPage = i;
		console.info('Page: %s', i);
		doc.addPage();

		const src = fs.readFileSync(`./tmp/${i}.svg`);
		const dom = new JSDOM(src);

		global.document = dom.window.document;
		global.HTMLStyleElement = dom.window.HTMLStyleElement;
		global.CSSStyleSheet = dom.window.CSSStyleSheet;
		global.CSSStyleRule = dom.window.CSSStyleRule;

		await doc.svg(dom.window.document.body.children[0], {
			x: 0,
			y: 0,
			width: 210,
			height: 297,
		});
	}
}

global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

const brokenImageSrc =
	'iVBORw0KGgoAAAANSUhEUgAAAA4AAAAQCAYAAAAmlE46AAABh0lEQVQoU42QSS9DURiGv7VfhKWEnyA2' +
	'WFizsLciJGrowDVU55VIjE3sxFhB1ZDiVlUapYYguLRor9f5DrdRuaJv8izOOc+zORQIBFAKRFRGP+f3' +
	'B6BlP/CYMecpo0NRFLBXFPt8fpzf6ThO50xJ3rzLkMduIfZ6vTi51hE5fZMYM85q6rUQ8tiXsdvtQfxK' +
	'x3biFb/Hd0citNlsRXBDLpdbhmbbimcRiWu4uMvhXstL+D+4IadzDPFLHRvHL6aETzLYT2ZxcPZF6lYH' +
	'NzQ66kQsnUdIfS4Jdrmh4eERqOKwdqiVBLuiIVKUIagXeaxEtQLL0UfMRKII7sSK7hnhckM0OKjgSISL' +
	'ew8ST2getePlqJuskDTPNWI2rBrvJFxuiByOARye57Gw+wDbklfIlYXIoH6yChObERIOCVc2ZLc7ZOha' +
	'DZpG31DDVDXNhRMcghuyWu1YT6TROF3zZ2TQEmxCNPUObqi/34q2hdZ/I+Oud60HvdY+UGdnF9rbO8yg' +
	'HxS9dVss+AQqZY47NSC2iwAAAABJRU5ErkJggg==';

// @ts-ignore
global.XMLHttpRequest = class XMLHttpRequest {
	/** @type {string} */
	responseType;
	/** @type {ArrayBuffer | Blob | Document | string} */
	response;
	/** @type {string} */
	responseText;
	/** @type {number} */
	status = 200;
	/** @type {(event: ProgressEvent) => *} */
	onload;
	/** @type {() => *} */
	onabort;
	/** @type {() => *} */
	onerror;
	#method;
	#url;
	#async;
	constructor() {}

	/**
	 *
	 * @param {string} method
	 * @param {string} url
	 * @param {boolean} async
	 * @param {string} user
	 * @param {string} password
	 */
	open(method, url, async, user, password) {
		this.#method = method;
		this.#url = url;
		this.#async = async;
	}

	/**
	 *
	 * @param {*} body
	 */
	send(body) {
		/** @type {Buffer} */
		let buf;
		const path = `./tmp/${currentPage}-${this.#url.replace(/\//g, '-')}`;
		if (fs.existsSync(path)) {
			buf = fs.readFileSync(path);
		} else {
			buf = Buffer.from(brokenImageSrc, 'base64');
		}

		switch (this.responseType) {
			case 'arraybuffer':
				this.response = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
				this.responseText = brokenImageSrc;
				break;
			case 'text':
				this.response = buf.toString('base64');
				this.responseText = buf.toString('base64');
				break;

			default:
				this.status = 400;
				throw new Error(`Not implemented: ${this.responseType}`);
				break;
		}

		this.onload(null);
	}
};

convertAll().then(() => {
	doc.save('jspdf.pdf');
});

/**
 * fix for https://github.com/MrRio/jsPDF/issues/3127
 * NOTE: Altough the issue is fixed, I now get gibberish text without this function
 * @param {jsPDF} doc
 */
function fix3127(doc) {
	const endOrg = doc.endFormObject;
	const getOrg = doc.getFormObject;
	const doOrg = doc.doFormObject;
	doc.getFormObject = function (key) {
		return getOrg.call(this, `${key}|PAGE ${currentPage}`);
	};
	doc.endFormObject = function (key) {
		return endOrg.call(this, `${key}|PAGE ${currentPage}`);
	};
	doc.doFormObject = function (key, matrix) {
		return doOrg.call(this, `${key}|PAGE ${currentPage}`, matrix);
	};
}
