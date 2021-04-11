if (process.env.NODE_ENV === 'production') {
	require('./writer.js');
} else {
	require('esm')(module)('./writer.js');
}
