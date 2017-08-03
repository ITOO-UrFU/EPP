console.time('parse');
var http = require('http');
var fs = require('fs');
var path = require('path');
const cheerio = require('cheerio')
const cheerioTableparser = require('cheerio-tableparser'); // TODO: may be not usable
const slug = require('slug')
const crypto = require('crypto');

const alasql = require('alasql');
const tableToCsv = require('node-table-to-csv');

const dataDir = "./data";
const resultDir = "./result";
let filesArr = [];
let data = [];

alasql('CREATE DATABASE db');
alasql('USE db');
fs.readdir(dataDir, (err, files) => {
    files.forEach(file => {
        filesArr.push(file);
        data.push(parse(file));
    });
    console.timeEnd('parse');
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
    let disciplines = [];
    var jsonTable = [];
    let headers = [];
    let term = 0;
    let tableName = "eduPlan" + crypto.createHash('md5').update(slug(file)).digest('hex').substring(0, 7);
    alasql('CREATE TABLE ' + tableName);

    var $ = cheerio.load(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    var document = buildHtml($.html());
    var tableParser = cheerioTableparser($);
    var csv = transMatrix($("#EduVersionPlanTab\\.EduDisciplineList").parsetable(true, true, true));

    $('#EduVersionPlanTab\\.EduDisciplineList').find('th').each(function(i, elem) {
        headers.push($(this).attr("id").replace("EduVersionPlanTab.EduDisciplineList.", "").split(".")[1]);
    });

    for (let i = 0; i < csv.length; i++) {
        if (i > 0) {
            let el = {};
            for (header in headers) {
                el[headers[header]] = csv[i][header]
            }
            jsonTable.push(el)
        }
    }
    alasql.tables[tableName].data = jsonTable;


    if (headers.join().indexOf("term10headerCell") !== -1) {
        term = 10
    } else if (headers.join().indexOf("term8headerCell") !== -1) {
        term = 8
    } else if (headers.join().indexOf("term7headerCell") !== -1) {
        term = 7
    }

    let response = {
        "source": file,
        "term": term,
        "version": getText($, "EduVersionPlanTab.EduVersionPlan.displayableTitle").trim(),
        "number": getText($, "EduVersionPlanTab.EduVersionPlan.number").trim(),
        "title": getText($, "EduVersionPlanTab.EduVersionPlan.title").trim(),
        "stage": getText($, "EduVersionPlanTab.EduVersionPlan.stage").trim(),
        "modules": alasql('SELECT ' +
            'indexheaderCell, titleheaderCell, disciplineNumberheaderCell, gosLoadInTestUnitsheaderCell ' +
            'FROM ' + tableName + ' WHERE disciplineNumberheaderCell != "______" AND disciplineNumberheaderCell != "" AND disciplineNumberheaderCell > 1000 AND indexheaderCell LIKE "М.%"'),

        "disciplines": alasql('SELECT ' +
            'indexheaderCell, titleheaderCell, disciplineNumberheaderCell, gosLoadInTestUnitsheaderCell,  term1headerCell, term2headerCell, term3headerCell, ' +
            'term4headerCell, term5headerCell, term6headerCell, term7headerCell, term8headerCell, term9headerCell, term10headerCell ' +
            'FROM ' + tableName + ' WHERE indexheaderCell != "" AND indexheaderCell REGEXP("^d*") AND disciplineNumberheaderCell != "______" AND disciplineNumberheaderCell != "" AND disciplineNumberheaderCell > 1000'),
    }

    for (module in response.modules) {
        var moduleIndex = response.modules[module].indexheaderCell.replace("М.", "") + "."
        disciplines = response.disciplines.filter(function(item) {
            return item.indexheaderCell.indexOf(moduleIndex) !== -1
        });
        response.modules[module]["disciplines"] = disciplines;
    }


    delete response.disciplines;
    console.log(response.modules)

    fs.writeFile(path.join(resultDir, tableName + ".json"), JSON.stringify(response), function(err) {
        if (err) {
            return console.log(err);
        }
        console.log(tableName + ".json was saved!");
    });
    return JSON.stringify(response)
}


function getText($, id) {
    var id = id.replace(/\./gm, "\\.")
    return $("#" + id).text().replace(/(\r\n|\n|\r|\t)/gm, "")
}

function getHTML($, id) {
    var id = id.replace(/\./gm, "\\.")
    return $("#" + id).html().replace(/(\r\n|\n|\r|\t)/gm, "")
}

function transMatrix(A) {
    var m = A.length,
        n = A[0].length,
        AT = [];
    for (var i = 0; i < n; i++) {
        AT[i] = [];
        for (var j = 0; j < m; j++) AT[i][j] = A[j][i];
    }
    return AT;
}