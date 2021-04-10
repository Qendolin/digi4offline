import { sanitizeSvg } from './sanitize.js';
import { toArrayBuffer } from './util.js';

const { DOMParser, XMLSerializer } = require('xmldom');

const asyncPool = require('tiny-async-pool');

export class RangeDownloader {
	/** @type {number} */
	poolSize;
	/** @type {import('./book').Book} */
	book;
	parser = new DOMParser();
	serializer = new XMLSerializer();
	/**
	 * @param {number} poolSize
	 * @param {import('./book').Book} book
	 */
	constructor(poolSize, book) {
		this.poolSize = poolSize;
		this.book = book;
	}

	/**
	 * @param {number[]} pages
	 * @param {(data: ArrayBuffer, info: {pageIndex: number, pageNr: number, pageCount: number, downloadNr: number}) => void} cb
	 */
	async download(pages, cb) {
		let resolveFirstPage;
		const firstPage = new Promise(function (resolve) {
			resolveFirstPage = resolve;
		});

		let downloadNr = 1;
		return asyncPool(this.poolSize, [...pages.entries()], async ([index, nr]) => {
			if (index !== 0) await firstPage;
			const data = await this._downloadPage(nr);
			if (index === 0) resolveFirstPage();

			cb(data, {
				pageCount: pages.length,
				pageIndex: index,
				pageNr: nr,
				downloadNr: downloadNr++,
			});
		});
	}

	/**
	 * @private
	 * @param {number} nr
	 * @returns {Promise<ArrayBuffer>}
	 */
	async _downloadPage(nr) {
		const src = await this.book.page(nr);
		if (src == null) {
			return;
		}

		const svg = this.parser.parseFromString(src, 'image/svg+xml');
		if (svg == null) {
			console.error(src);
			return;
		}
		sanitizeSvg(svg);
		await this._inlineImages(svg, nr);
		return toArrayBuffer(Buffer.from(this.serializer.serializeToString(svg), 'utf8'));
	}

	/**
	 * @private
	 * @param {Document} svg
	 * @param {number} pageNr
	 */
	async _inlineImages(svg, pageNr) {
		const images = Array.from(svg.documentElement.getElementsByTagName('image'));
		await asyncPool(2, images, async (img) => {
			const data = await this._downloadImage(pageNr, img);
			if (!data) {
				img.parentNode.removeChild(img);
				return;
			}
			img.setAttribute('xlink:href', `data:image;base64,${data.toString('base64')}`);
		});
	}

	/**
	 * @private
	 * @param {number} pageNr
	 * @param {SVGImageElement} img
	 * @returns {Promise<Buffer>}
	 */
	_downloadImage(pageNr, img) {
		const attr = img.hasAttribute('xlink:href') ? 'xlink:href' : 'href';
		return this.book.image(pageNr, img.getAttribute(attr));
	}
}
