import { retryAsync, ResponseError } from './util.js';
import fetch, { FetchError } from 'node-fetch';
import memoize from 'memoizee';
import { MetaInfoParser } from './meta';
import { DOMParser } from 'xmldom';

/**
 * @typedef {import('./auth').Cookies} Cookies
 */

/**
 * @typedef Options
 * @property {number} retryPage
 * @property {number} retryImage
 */

export class Book {
	/** @type {string} */
	id;
	/** @type {Cookies} */
	credentials;
	/** @type {Options} */
	options;

	/** @type {number} */
	_initalized = 0;
	/** @type {number} */
	_pageCount;
	/** @type {string} */
	_bookHtml;
	/** @type {(number) => string} */
	_pageUrlFormat = (nr) => `${nr}/`;

	/**
	 * @param {string} id
	 * @param {Cookies} creds
	 * @param {Options} [options]
	 */
	constructor(id, creds, options) {
		this.id = id;
		this.credentials = creds;
		this.options = {
			retryPage: 10,
			retryImage: 10,
			...options,
		};

		this.init = memoize(this.initialize, { promise: true });
		this.info = memoize(this.info, { promise: true });
		this.pageCount = memoize(this.pageCount, { promise: true });
		this.page = memoize(this.page, { promise: true });
		this.resolveRanges = memoize(this.resolveRanges, { promise: true });
		this.image = memoize(this.image, { promise: true });
	}

	get url() {
		return `https://a.digi4school.at/ebook/${this.id}/`;
	}

	async initialize() {
		if (this._initalized != 0) return;
		this._initalized = 1;

		this._bookHtml = await fetch(this.url, {
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: this.credentials.toString(),
			},
			method: 'GET',
		}).then((res) => {
			if (!res.ok) throw new ResponseError('failed to fetch book html', res);
			return res.text();
		});

		const match = this._bookHtml.match(/IDRViewer.makeNavBar\((\d+).*?(true|false)\)/);
		if (match == null) {
			throw new Error(`Could not match init regex`);
		}

		this._pageCount = parseInt(match[1]);
		const indirectPages = match[2] != 'false';

		if (indirectPages) {
			this._pageUrlFormat = await this._getIndirectPageUrlFormat();
		} else {
			this._pageUrlFormat = (_nr) => '';
		}

		this._initalized = 2;
	}

	isInitialzed() {
		return this._initalized == 2;
	}

	/**
	 * @returns {Promise<(number) => string>}
	 */
	async _getIndirectPageUrlFormat() {
		const href = new URL('1.html', this.url).href;
		const firstPageHtml = await fetch(href, {
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: this.credentials.toString(),
			},
			method: 'GET',
		}).then((res) => {
			if (!res.ok) throw new ResponseError('failed to fetch first page html', res);
			return res.text();
		});
		console.log(firstPageHtml);
		const firstPage = new DOMParser().parseFromString(firstPageHtml, 'text/html');

		const jpedal = firstPage.getElementById('jpedal');
		if (jpedal == null) {
			console.warn('unexpected format: no jpedal found');
			return this._pageUrlFormat;
		}
		const svgs = Array.from(jpedal.getElementsByTagName('object'));
		if (svgs.length == 0) {
			console.warn('unexpected format: no <object> found');
			return this._pageUrlFormat;
		}

		const svgSource = svgs[0].getAttribute('data');
		if (!svgSource || !svgSource.includes('1.svg')) {
			console.warn('unexpected format: no 1.svg found');
			return this._pageUrlFormat;
		}

		const parts = svgSource.replace('1.svg', '').split('1');
		return (nr) => parts.join(String(nr));
	}

	/**
	 * @param {number} nr
	 * @returns {string}
	 */
	pageBaseUrl(nr) {
		return new URL(this._pageUrlFormat(nr), this.url).href;
	}

	/**
	 * @returns {Promise<import('./meta').MetaInfo>}
	 */
	async info() {
		return MetaInfoParser.parse(this._bookHtml);
	}

	/**
	 * @returns {number}
	 */
	pageCount() {
		if (!this.isInitialzed()) {
			throw new Error(`book is not initialized`);
		}

		return this._pageCount;
	}

	/**
	 * @param {number} nr
	 * @returns {Promise<string>} Page content
	 */
	async page(nr) {
		const href = new URL(`${nr}.svg`, this.pageBaseUrl(nr)).href;
		const content = await retryAsync(this.options.retryPage, async () => {
			return fetch(href, {
				headers: {
					accept: '*/*',
					'accept-language': '*',
					cookie: this.credentials.toString(),
				},
				method: 'GET',
			})
				.then((res) => {
					if (!res.ok) throw new ResponseError('failed to fetch page', res);
					return res.text();
				})
				.catch((e) => {
					if (e instanceof FetchError) return;
					else throw e;
				});
		});
		return content || '';
	}

	/**
	 * @param {import('./util').PageRange[]} ranges
	 * @param {boolean} useLabels
	 */
	async resolveRanges(ranges, useLabels) {
		const pageCount = this.pageCount();
		const info = useLabels ? await this.info() : null;

		const pages = ranges
			.reduce((pages, { from: fromPageOrLabel, to: toPageOrLabel }, index) => {
				/** @type {number} */
				let from;
				/** @type {number} */
				let to;
				if (useLabels) {
					from = info.labelPage(fromPageOrLabel);
					to = info.labelPage(toPageOrLabel);
				} else {
					from = Number(fromPageOrLabel);
					to = Number(toPageOrLabel);
				}

				if (isNaN(from) && index !== 0) {
					throw new Error(`Range ${index + 1} has invalid from`);
				}
				if (isNaN(to) && index != ranges.length - 1) {
					throw new Error(`Range ${index + 1} has invalid to`);
				}

				from = isNaN(from) ? 1 : from;
				to = isNaN(to) ? pageCount : to;

				[...Array(to - from + 1)].forEach((_, i) => pages.add(Math.min(pageCount, from + i)));
				return pages;
			}, new Set())
			.values();

		return [...pages];
	}

	/**
	 *
	 * @param {number} pageNr
	 * @param {string} path
	 * @returns {Promise<Buffer>}
	 */
	async image(pageNr, path) {
		const href = new URL(path, this.pageBaseUrl(pageNr)).href;

		return retryAsync(this.options.retryImage, () => {
			return fetch(href, {
				headers: {
					cookie: this.credentials.toString(),
				},
			})
				.then((res) => {
					if (!res.ok) throw new ResponseError('failed to download image', res);
					return res.buffer();
				})
				.catch((e) => {
					if (e instanceof FetchError) return;
					else throw e;
				});
		});
	}
}
