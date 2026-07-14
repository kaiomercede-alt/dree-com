function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  const names = Object.keys(process.env)
    .filter((name) => /(UPSTASH|KV|REDIS|STORAGE)/i.test(name))
    .sort();

  return json(res, 200, {
    names,
    count: names.length
  });
};
