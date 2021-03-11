const { Worker } = require('worker_threads');
const fetch = require('node-fetch');
const FetchError = require('node-fetch').FetchError;
const { DOMParser, XMLSerializer } = require('xmldom');
const asyncPool = require('tiny-async-pool');
const readlineSync = require('readline-sync');
const { program } = require('commander');
const path = require('path');
const fs = require('fs');

program.requiredOption('-e, --email <address>', 'Your digi4school login email');
program.requiredOption('-b, --book <id>', 'The id of the book you want to download');
program.option('-o, --out <name>', 'Output path, can specify file or folder');
program.option('-p, --password <password>', 'Your digi4school login password (not recommended)');
program.option(
	'--from <pageNr>',
	'The page number to start downloading (inclusive)',
	(value, _) => parseInt(value),
	'1'
);
program.option('--to <pageNr>', 'The page number to stop downloading (inclusive)', (value, _) => parseInt(value));
program.option(
	'--dop <degree>',
	'The amount of pages that can be downloaded at the same time',
	(value, _) => parseInt(value),
	'5'
);
program.option('--faster', "Don't retry downloading images");

program.on('--help', () => {
	console.log('');
	console.log(
		'The password argument is optional. When not provided you will be prompted to input your password into the terminal. This way is recommended because you password will be hidden.'
	);
	console.log('');
	console.log('The book id is part of the url of an open book. (The book must be activated for your account) e.g.:');
	console.log('	for /ebook/5432/1/index.html the id is 5432/1');
	console.log('	for /ebook/3404/ the id is 3404');
});

program.parse(process.argv);

program.from = Number(program.from) || 1;

const metaInfoNames = [
	'title',
	'sbnr',
	'publisher',
	'publisherweb',
	'publisheradr',
	'publishertel',
	'publishermail',
	'pageLabels',
];

class Cookies {
	cookies = new Map();
	put(...cookies) {
		cookies.forEach((c) => {
			const [k, v] = c.split(';').slice(0, 1).toString().split('=', 2);
			this.cookies.set(k, v);
		});
	}
	remove(c) {
		const [k] = c.split(';').slice(0, 1).toString().split('=', 1);
		this.cookies.delete(k);
	}
	toString() {
		return [...this.cookies.entries()].map((e) => `${e[0]}=${e[1]}`).join('; ');
	}
}

async function authBook(b, c) {
	let src = await fetch(`https://digi4school.at/br/find/${b}/`, {
		headers: {
			cookie: c,
		},
	}).then((res) => res.text());
	let doc = new DOMParser().parseFromString(src, 'text/html');

	let f = doc.getElementsByTagName('form')[0];
	let params = new URLSearchParams();
	Array.from(f.getElementsByTagName('input')).forEach((i) => {
		params.set(i.getAttribute('name'), i.getAttribute('value'));
	});

	let url = f.getAttribute('action');
	src = await fetch(url, {
		method: 'POST',
		body: params,
		headers: {
			accept: '*/*',
			'accept-language': '*',
			cookie: c,
			'content-type': 'application/x-www-form-urlencoded',
		},
		mode: 'cors',
	}).then((res) => {
		if (!res.ok) throw res;
		c.put(...res.headers.raw()['set-cookie']);
		return res.text();
	});
	doc = new DOMParser().parseFromString(src, 'text/html');

	f = doc.getElementsByTagName('form')[0];
	params = new URLSearchParams();
	Array.from(f.getElementsByTagName('input')).forEach((i) => {
		params.set(i.getAttribute('name'), i.getAttribute('value'));
	});
	url = f.getAttribute('action');
	return await fetch(url, {
		method: 'POST',
		body: params,
		headers: {
			accept: '*/*',
			'accept-language': '*',
			cookie: c,
			'content-type': 'application/x-www-form-urlencoded',
		},
		mode: 'cors',
		redirect: 'manual',
	}).then((res) => {
		if (res.status != 302) throw res;
		c.put(...res.headers.raw()['set-cookie']);
		return c;
	});
}

function authUser(e, p, c) {
	return fetch('https://digi4school.at/br/xhr/login', {
		headers: {
			accept: '*/*',
			'accept-language': '*',
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
		},
		body: `email=${encodeURIComponent(e)}&password=${encodeURIComponent(p)}`,
		method: 'POST',
		mode: 'cors',
	}).then(async (res) => {
		if (!res.ok) throw res;
		switch (await res.text()) {
			case 'OK':
				console.log('Login successful');
				break;
			case 'KO':
				console.log('Login unsuccessful');
				process.exit(-1);
			default:
				console.log(
					'Login returned unexpected response, the login data either was bad or this tool is out of date. Continuing...'
				);
		}

		c.put(...res.headers.raw()['set-cookie']);
		return c;
	});
}

async function fetchPage(b, p, c) {
	let retry = 10;
	let res;
	do {
		res = await fetch(`https://a.digi4school.at/ebook/${b}/${p}/${p}.svg`, {
			headers: {
				accept: '*/*',
				'accept-language': '*',
				cookie: c,
			},
			method: 'GET',
			mode: 'cors',
		})
			.then((res) => {
				if (!res.ok) throw res;
				retry = 0;
				return res.text();
			})
			.catch((e) => {
				if (e instanceof FetchError) retry--;
				else throw e;
			});
	} while (retry != 0);
	return res;
}

async function fetchInfo(b, c) {
	const src = await fetch(`https://a.digi4school.at/ebook/${b}/`, {
		headers: {
			accept: '*/*',
			'accept-language': '*',
			cookie: c,
		},
		method: 'GET',
		mode: 'cors',
	}).then((res) => {
		if (!res.ok) throw res;
		return res.text();
	});
	const doc = new DOMParser().parseFromString(src, 'text/html');
	const metas = Array.from(doc.documentElement.getElementsByTagName('meta'));
	const info = {};
	for (const meta of metas) {
		const name = meta.getAttribute('name');
		if (metaInfoNames.includes(name)) {
			info[name] = meta.getAttribute('content');
		}
	}
	return info;
}

function getPages(b, c) {
	return fetch(`https://a.digi4school.at/ebook/${b}/`, {
		headers: {
			cookie: c,
		},
	})
		.then((res) => res.text())
		.then((html) => parseInt(html.match(/IDRViewer.makeNavBar\((\d+)/)[1]));
}

if (!program.password) {
	program.password = readlineSync.question('Password? ', {
		hideEchoBack: true,
		mask: '',
	});
}

authUser(program.email, program.password, new Cookies())
	.then(async (c) => {
		await authBook(program.book, c);

		console.time('duration');
		let pages = await getPages(program.book, c);
		if ('to' in program) pages = Math.min(pages, program.to);
		if ('from' in program) pages -= program.from - 1;
		const docInfo = await fetchInfo(program.book, c);
		console.log(
			'Title: %s\nSBNR: %s\nPublisher: %s\n\tURL: %s\n\tAddress: %s\n\tPhone Number: %s\n\tEmail Adress: %s',
			docInfo.title ?? '',
			docInfo.sbnr ?? '',
			docInfo.publisher ?? '',
			docInfo.publisherweb ?? '',
			docInfo.publisheradr ?? '',
			docInfo.publishertel ?? '',
			docInfo.publishermail ?? ''
		);

		createOut(docInfo, pages);

		const writer = new Worker('./writer.js', {
			workerData: {
				file: program.out,
				info: docInfo,
				from: program.from,
			},
		});
		let writeProgress = 0;
		writer.on('message', (m) => {
			switch (m.action) {
				case 'write':
					console.log('Wrote page %s/%s %s', ++writeProgress, pages, m.data.page);
					break;
				case 'error':
					console.error(m.data.message, ...m.data.args);
					break;
			}
		});
		let downloadProgress = 0;
		const firstPage = (() => {
			let r;
			const p = new Promise((res) => {
				r = res;
			});
			p.resolve = r;
			return p;
		})();

		const XML = new XMLSerializer();
		await asyncPool(
			program.dop,
			Array(pages)
				.fill()
				.map((_, i) => {
					if ('from' in program) return program.from + i;
					return i;
				}),
			async (page) => {
				if (page != program.from) await firstPage;
				const src = await fetchPage(program.book, page, c);
				if (src == null) {
					++downloadProgress;
					console.log('Failed to download page %s', page);
					writer.postMessage({
						action: 'add',
						data: {
							page: page,
						},
					});
					if (page == program.from) firstPage.resolve();
					return;
				}
				const svg = new DOMParser().parseFromString(src, 'image/svg+xml');
				fixStuff(svg);
				await asyncPool(2, Array.from(svg.documentElement.getElementsByTagName('image')), async (img) => {
					const attr = img.hasAttribute('xlink:href') ? 'xlink:href' : 'href';
					const href = new URL(
						img.getAttribute(attr),
						`https://a.digi4school.at/ebook/${program.book}/${page}/`
					).href;
					let retry = program.faster ? 1 : 10;
					let data;
					do {
						data = await fetch(href, {
							headers: {
								cookie: c,
							},
						})
							.then((res) => {
								if (!res.ok) throw res;
								retry = 0;
								return res.buffer();
							})
							.catch((e) => {
								if (e instanceof FetchError) retry--;
								else throw e;
							});
					} while (retry != 0);

					if (!data) {
						img.parentNode.removeChild(img);
						return;
					}
					img.setAttribute('xlink:href', `data:image;base64,${data.toString('base64')}`);
				});

				let buf = Buffer.from(XML.serializeToString(svg), 'utf8');
				buf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
				writer.postMessage(
					{
						action: 'add',
						data: {
							src: buf,
							page: page,
						},
					},
					[buf]
				);
				console.log('Downloaded page %s/%s %s', ++downloadProgress, pages, page);
				if (page == program.from) firstPage.resolve();
			}
		);
		await new Promise((res) => {
			writer.on('message', (m) => {
				if (m == 'done') res();
			});
			writer.postMessage({ action: 'end' });
			console.log('Waiting for writer to fininsh...');
		});
		console.timeEnd('duration');
		writer.unref();
	})
	.catch(console.error);

function createOut(docInfo, pages) {
	let out = program.out ?? './';
	let file = path.basename(out);
	let dir = path.dirname(out);
	if (out.endsWith('/') || out.endsWith('\\') || !out) {
		file =
			[
				'ebook',
				program.book.replace(/\//, '_'),
				docInfo.sbnr ? `sbnr_${docInfo.sbnr}` : null,
				`p_${program.from ?? 0}-${program.to ?? program.from + pages - 1}`,
			]
				.filter((x) => !!x)
				.join('-') + '.pdf';
		dir = out;
	}

	fs.mkdirSync(dir, { recursive: true });
	out = path.join(path.resolve(dir), file);
	if (fs.existsSync(out)) fs.truncateSync(out);
	program.out = out;
}

/**
 * Fixes:
 * 	 stroke-dasharray values of 0
 * @param {Document} svg
 */
function fixStuff(svg) {
	const zero = /0+%?/g;
	for (const e of Array.from(svg.documentElement.getElementsByTagName('*'))) {
		if (e.hasAttribute('stroke-dasharray')) {
			const fix = e
				.getAttribute('stroke-dasharray')
				.split(/,?\s*/g)
				.filter((v) => v != '')
				.map((v) => (zero.test(v) ? '1' : v))
				.join(', ');
			e.setAttribute('stroke-dasharray', fix);
		}
		if (e.tagName.toUpperCase() == 'STYLE' && e.firstChild && e.firstChild.nodeValue) {
			const fix = e.firstChild.nodeValue.replace(/stroke-dasharray\s*:(.*?)(;|\n)/gi, (_, value, rest) => {
				return `stroke-dasharray: ${value
					.split(/,?\s*/g)
					.filter((v) => v != '')
					.map((v) => (zero.test(v) ? '1' : v))
					.join(', ')}${rest}`;
			});
			e.firstChild.nodeValue = fix;
			e.firstChild.data = fix;
		}
		// if (e.tagName.toUpperCase() == 'STYLE') console.log(e.firstChild.nodeValue);
	}
}
