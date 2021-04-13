import { sanitizeSvg } from './sanitize.js';
import { toArrayBuffer } from './util.js';
import { DOMParser, XMLSerializer } from 'xmldom';
import asyncPool from 'tiny-async-pool';

/**
 * @typedef {import('./util').BufferRange} Range
 */

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
	 * @param {(data: {svg: Buffer, images: {buffer: Buffer, map: Map<string, Range>}}, info: {pageIndex: number, pageNr: number, pageCount: number, downloadNr: number}) => void} cb
	 */
	async download(pages, cb) {
		let resolveFirstPage;
		const firstPage = new Promise(function (resolve) {
			resolveFirstPage = resolve;
		});

		let downloadNr = 1;
		return asyncPool(this.poolSize, [...pages.entries()], async ([index, nr]) => {
			if (index !== 0) await firstPage;
			const page = await this._downloadPage(nr);
			if (index === 0) resolveFirstPage();

			cb(page, {
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
	 * @returns {Promise<{svg: Buffer, images: {buffer: Buffer, map: Map<string, Range>}}>}
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
		const images = await this._downloadImages(svg, nr);
		return { svg: Buffer.from(this.serializer.serializeToString(svg), 'utf8'), images: images };
	}

	/**
	 * @private
	 * @param {Document} svg
	 * @param {number} pageNr
	 * @returns {Promise<{buffer: Buffer, map: Map<string, Range>}>}
	 */
	async _downloadImages(svg, pageNr) {
		const chunks = [];
		/** @type {Map<string, Range>} */
		const chunkMap = new Map();
		let totalLength = 0;

		const images = Array.from(svg.documentElement.getElementsByTagName('image'));
		await asyncPool(2, images, async (img) => {
			const { link, data } = await this._downloadImage(pageNr, img);
			if (!data) {
				console.warn('Failed to download image %s on page %s', link, pageNr);
				return;
			}

			chunks.push(data);
			chunkMap.set(link, { start: totalLength, end: totalLength + data.length });
			totalLength += data.length;
		});

		return { buffer: Buffer.concat(chunks, totalLength), map: chunkMap };
	}

	/**
	 * @private
	 * @param {number} pageNr
	 * @param {SVGImageElement} img
	 * @returns {Promise<{link: string, data: Buffer}>}
	 */
	async _downloadImage(pageNr, img) {
		const attr = img.hasAttribute('xlink:href') ? 'xlink:href' : 'href';
		const link = img.getAttribute(attr);
		return {
			link: link,
			data: await this.book.image(pageNr, link),
		};
	}
}
