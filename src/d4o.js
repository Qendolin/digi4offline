import { User } from './auth.js';
import { RangeDownloader } from './download.js';
import { findRanges } from './util.js';
import { Writer } from './worker/wrapper.js';
const path = require('path');
const fs = require('fs');

/**
 * @typedef Options
 * @property {number} dop
 * @property {number} pageRetries
 * @property {number} imageRetries
 * @property {boolean} labels
 */

export class Digi4Offline {
	options;
	/** @type {User} */
	#user;
	/**
	 * @param {Options} options
	 */
	constructor(options) {
		this.options = options;
	}

	/**
	 * @param {string} email
	 * @param {string} password
	 * @returns {Promise<void>}
	 */
	login(email, password) {
		this.#user = new User();
		return this.#user.authenticate(email, password);
	}

	/**
	 * @param {string} bookId
	 * @param {string} file
	 * @param {import('./util').PageRange[]} ranges
	 */
	async download(bookId, file, ranges) {
		const book = await this.#user.aquireBook(bookId);
		book.options = {
			...book.options,
			retryImage: this.options.imageRetries,
			retryPage: this.options.pageRetries,
		};

		const downloader = new RangeDownloader(this.options.dop, book);

		const pages = await book.resolveRanges(ranges, this.options.labels);
		const info = await book.info();
		console.log(
			'Title: %s\nSBNR: %s\nPublisher: %s\n\tURL: %s\n\tAddress: %s\n\tPhone Number: %s\n\tEmail Adress: %s',
			info.title,
			info.sbnr,
			info.publisher,
			info.publisherweb,
			info.publisheradr,
			info.publishertel,
			info.publishermail
		);
		const pdfPath = this._createPdf(file || './', bookId, info, pages);

		const writer = new Writer(pdfPath, info);
		writer.on('write', ({ page, pageIndex }) => {
			console.log('Wrote page %s/%s %s', pageIndex + 1, pages.length, page);
		});
		writer.on('error', ({ message: msg, args = [] }) => {
			console.error(msg, ...args);
		});

		await downloader.download(pages, ({ svg, images }, { pageIndex, pageNr, downloadNr }) => {
			console.log('Downloaded page %s/%s %s', downloadNr, pages.length, pageNr);
			writer.write(svg, images.map, images.buffer, pageIndex, pageNr);
		});

		writer.end();
		console.log('Waiting for writer to fininsh...');
		await writer.done;
		console.log(pdfPath);
		writer.worker.unref();
	}

	/**
	 * @private
	 * @param {string} out
	 * @param {string} bookId
	 * @param {import('./meta').MetaInfo} metaInfo
	 * @param {any} pages
	 */
	_createPdf(out, bookId, metaInfo, pages) {
		let file = path.basename(out);
		let dir = path.dirname(out);
		if (out.endsWith('/') || out.endsWith('\\') || !out) {
			file =
				[
					'ebook',
					bookId.replace(/\//, '_'),
					metaInfo.sbnr ? `sbnr_${metaInfo.sbnr}` : null,
					`p_${findRanges(pages)}`,
				]
					.filter((x) => !!x)
					.join('-') + '.pdf';
			dir = out;
		}

		fs.mkdirSync(dir, { recursive: true });

		const finalPath = path.join(path.resolve(dir), file);
		if (fs.existsSync(finalPath)) fs.truncateSync(finalPath);
		return finalPath;
	}
}
