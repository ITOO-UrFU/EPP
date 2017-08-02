var http = require('http');
var fs = require('fs');
var path = require('path');
const cheerio = require('cheerio')
const cheerioTableparser = require('cheerio-tableparser');

const dataDir = "./data";
let filesArr = [];
let data = [];

fs.readdir(dataDir, (err, files) => {
    files.forEach(file => {
        filesArr.push(file);
        data.push(parse(file));
    });
})





http.createServer(function(req, res) {
    var html = buildHtml(req);

    res.writeHead(200, {
        'Content-Type': 'text/html'
    });
    res.end(html);
}).listen(8080);

function buildHtml(req) {
    var header = '<meta charset="utf-8"/>';
    var body = filesArr.join("<br />") + "<br/><br/><b>DATA:</b><br/>" + data.join("<br />");
    return '<!DOCTYPE html>' +
        '<html><head>' + header + '</head><body>' + body + '</body></html>';
};

function parse(file) {
    var $ = cheerio.load(fs.readFileSync(path.join(dataDir, file), 'utf8'));

    return JSON.stringify({
        "version": getText($, "EduVersionPlanTab.EduVersionPlan.displayableTitle"),
        "number": getText($, "EduVersionPlanTab.EduVersionPlan.number"),
        "title": getText($, "EduVersionPlanTab.EduVersionPlan.title"),
        "stage": getText($, "EduVersionPlanTab.EduVersionPlan.stage"),
    });
}


function getText($, id) {
    var id = id.replace(/\./gm, "\\.")
    return $("#" + id).text().replace(/(\r\n|\n|\r|\t)/gm, "")
}