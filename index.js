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
const doneDir = "./done";
const dumpDir = "./dump";
let filesArr = [];
let data = [];
let isWaiting = true;

alasql('CREATE DATABASE db');
alasql('USE db');

function Main() {
    this.Enabled = true;
    this.Loop = function() {
        if (this.Enabled == true) {
            worker();
            setTimeout(this.Loop.bind(this), 1000);
        }
    };
    this.Stop = function() {
        this.Enabled = false;
    };

    function worker() {
        if (fs.existsSync(resultDir) == false) {
            fs.mkdir(resultDir);
        };
        if (fs.existsSync(dumpDir) == false) {
            fs.mkdir(dumpDir);
        };
        if (fs.existsSync(doneDir) == false) {
            fs.mkdir(doneDir);
        };
        if (fs.existsSync(dataDir)) {
            fs.readdir(dataDir, (err, files) => {
                if (files != undefined) {
                    files.forEach(file => {
                        console.log(file);
                        filesArr.push(file);
                        data.push(parse(file));
                    });
                }
            })
        } else {
            fs.mkdir(dataDir);
        }
        return isWaiting
    }
}

var w = new Main();
setTimeout(w.Loop.bind(w), 7000);
// setTimeout(w.Stop.bind(w), 3000);


function parse(file) {
    try {
        let disciplines = [];
        var jsonTable = [];
        let headers = [];
        let term = 0;
        let tableName = "eduPlan" + crypto.createHash('md5').update(slug(file)).digest('hex');

        //Чекаем, ести ли такая таблица в списке таблиц
        let tables = alasql("SHOW TABLES FROM db")
        if (tables.find(o => o.tableid === tableName) == undefined) {
            //Создаем, если нет
            alasql('CREATE TABLE ' + tableName);
        }

        var $ = cheerio.load(fs.readFileSync(path.join(dataDir, file), 'utf8'));
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
                "modules": alasql('SELECT * FROM ' + tableName +
                    ' WHERE disciplineNumberheaderCell != "______" AND disciplineNumberheaderCell != "" AND disciplineNumberheaderCell > 1000 AND indexheaderCell LIKE "М.%"'),

                "disciplines": alasql('SELECT * FROM ' + tableName +
                    ' WHERE indexheaderCell != "" AND indexheaderCell REGEXP("^d*") AND allloadheaderCell > 0'),
            }
            //Хуй знает, как в план попадают дисциплины, и что они имели ввиду
            //AND disciplineNumberheaderCell != "______" AND disciplineNumberheaderCell != "" AND disciplineNumberheaderCell > 1000


        for (module in response.modules) {
            var moduleIndex = response.modules[module].indexheaderCell.replace("М.", "") + "."
            disciplines = response.disciplines.filter(function(item) {
                return item.indexheaderCell.indexOf(moduleIndex) !== -1
            });
            //Ищем первый семести дисциплины
            for (let i = 0; i < disciplines.length; i++) {
                keys = Object.keys(disciplines[i]).filter(function(key) {
                    return key.indexOf("__term") !== -1
                })
                disciplines[i]["firstSemester"] = 99
                for (let k = 0; k < keys.length; k++) {
                    let ze = disciplines[i][keys[k]]
                    let sem = keys[k].replace(/[^\d.]/g, '');
                    if (ze != "" && ze != undefined && 0 < sem < disciplines[i]["firstSemester"]) {
                        disciplines[i]["firstSemester"] = sem;
                    }

                }
            }
            response.modules[module]["disciplines"] = disciplines;
        }

        delete response.disciplines;

        //На всякий случай дампаем базу в файл
        var tableIds = tables.map(function(tableObj) {
            return tableObj["tableid"];
        });
        for (let i = 0; i < tableIds.length; i++) {
            var sqlDump = alasql('SELECT * INTO JSON(?) FROM ' + tableIds[i], [path.join(dumpDir, tableIds[i] + ".sql")]);
        }

        //Пишем рабочий json, который потом отправим на сервер
        fs.writeFile(path.join(resultDir, tableName + ".json"), JSON.stringify(response), function(err) {
            if (err) {
                return console.log(err);
            }
            console.log(tableName + ".json was saved!");
        });
        //Перемещаем html файл в папку с отработанными файлами, пусть лежит там пока
        fs.renameSync(path.join(dataDir, file), path.join(doneDir, file));
        return JSON.stringify(response)
    } catch (e) {

    }
}


function getText($, id) {
    //Принимает основную функцию Чирио и id элемента
    //Возвращает текст без переносов строк
    var id = id.replace(/\./gm, "\\.")
    return $("#" + id).text().replace(/(\r\n|\n|\r|\t)/gm, "")
}

function getHTML($, id) {
    //Принимает основную функцию Чирио и id элемента
    //Возвращает html без переносов строк
    var id = id.replace(/\./gm, "\\.")
    return $("#" + id).html().replace(/(\r\n|\n|\r|\t)/gm, "")
}

function transMatrix(A) {
    //Транспонирует матрицу
    var m = A.length,
        n = A[0].length,
        AT = [];
    for (var i = 0; i < n; i++) {
        AT[i] = [];
        for (var j = 0; j < m; j++) AT[i][j] = A[j][i];
    }
    return AT;
}