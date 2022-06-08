#!/usr/bin/env node
if (process.env.NODE_ENV === 'production') {
	module.exports = require('./main.js');
} else {
	// @ts-ignore
	require = require('esm')(module);
	module.exports = require('./jspdf.js');
}
