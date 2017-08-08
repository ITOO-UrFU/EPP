var fs = require('fs');
var path = require('path');
const cheerio = require('cheerio')
const cheerioTableparser = require('cheerio-tableparser'); // TODO: may be not usable
const slug = require('slug')
const crypto = require('crypto');

const alasql = require('alasql');
const tableToCsv = require('node-table-to-csv');

const uniModules = require('./uni_data/modules');

const dataDir = "./data";
const resultDir = "./result";
const doneDir = "./done";
const dumpDir = "./dump";
const uniData = "./uni_data";

const romanDigits = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
let filesArr = [];
let data = [];
const doneFiles = true; //Убирать обработанные файлы?

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
        let dirs = [dataDir, doneDir, dumpDir, uniData, resultDir]
        for (dir in dirs) {
            if (fs.existsSync(dirs[dir]) == false) {
                fs.mkdir(dirs[dir]);
            };
        }

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
    }
}

var w = new Main();
setTimeout(w.Loop.bind(w), 10);
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

        //Теперь пытаемся засунуть семестры экзамена/зачета в дисциплины
        const exam_id = $('[title="Экзамен"]').attr('id').split(".").slice(-1)[0];
        const credit_id = $('[title="Зачет"]').attr('id').split(".").slice(-1)[0];
        //Хуй знает, как в план попадают дисциплины, и что они имели ввиду
        //AND disciplineNumberheaderCell != "______" AND disciplineNumberheaderCell != "" AND disciplineNumberheaderCell > 1000


        //Раскладываем дисциплины по модулям

        for (module in response.modules) {
            var moduleIndex = response.modules[module].indexheaderCell.replace("М.", "") + "."
            disciplines = response.disciplines.filter(function(item) {
                return item.indexheaderCell.indexOf(moduleIndex) !== -1
            });

            //Пытаемся разбить дисциплины на части.
            // Примем за правило, что если дисциплина изучается несколько семестров,
            // то каждый семестр изучения - это новая дисциплина

            // Сперва найдём "большие" дисциплины, которые надо разделить

            for (i in disciplines) {
                let discipline = disciplines[i];

                //Ищем экзамены и парсим
                let exam = discipline[exam_id]
                if (exam == undefined) { exam = "" }; // маленький костыль
                if (exam.indexOf("-") !== -1) {
                    exam = range(parseInt(exam.split("-")[0]), parseInt(exam.split("-")[1]))
                } else if (exam == "") {
                    exam = [0]
                } else {
                    exam = [parseInt(exam)]
                }

                //Ищем зачеты и парсим
                let credit = discipline[credit_id]
                if (credit == undefined) { credit = "" }; // маленький костыль
                if (credit.indexOf("-") !== -1) {
                    credit = range(parseInt(credit.split("-")[0]), parseInt(credit.split("-")[1]))

                } else if (credit == "") {
                    credit = [0]

                } else {
                    credit = [parseInt(credit)]
                }

                let keys = Object.keys(discipline).filter(function(key) {
                    return key.indexOf("__term") !== -1
                })
                let semesters = [];
                for (let k = 0; k < keys.length; k++) {
                    if (parseInt(discipline[keys[k]]) > 0) {
                        if (parseInt(discipline[keys[k]]) > 0) {
                            semesters.push(keys[k].replace(/[^\d.]/g, ''));
                        }
                    }
                }
                if (semesters.length > 1 && discipline.indexheaderCell.indexOf("М.") == -1 &&
                    response.modules[module].titleheaderCell.toLowerCase().indexOf("практик") === -1) { // Большая дисциплина
                    for (var s = 0; s < semesters.length; s++) {
                        var currentCredit = 0;
                        var currentExam = 0;
                        // Трудоёмкость новой дисциплины
                        let load = parseInt(discipline["__term" + semesters[s] + "headerCell"]);
                        semesterHeaderCell = "__term" + semesters[s] + "headerCell";

                        if (credit.indexOf(parseInt(semesters[s])) >= 0) {
                            currentCredit = parseInt(semesters[s])
                        }

                        if (exam.indexOf(parseInt(semesters[s])) >= 0) {
                            currentExam = parseInt(semesters[s])
                        }

                        // Затем наклонируем их с убиранием ненужных семестров и срезанием нагрузки
                        disciplines.push({
                            "titleheaderCell": discipline.titleheaderCell + " " + romanDigits[s],
                            "indexheaderCell": discipline.indexheaderCell + "." + semesters[s],
                            "orderheaderCell": discipline.orderheaderCell,
                            "gosLoadInTestUnitsheaderCell": load,
                            "allloadheaderCell": load * 36,
                            "disciplineNumberheaderCell": discipline.disciplineNumberheaderCell,
                            "exam": currentExam,
                            "credit": currentCredit,
                            [semesterHeaderCell]: load

                        })
                    }
                    //Удаляем толстую дисциплину из респонса
                    disciplines.splice(i, 1)
                }
            }
            //Ищем первый семестр дисциплины
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

            //Ого, всё сложили в респонс. Можно из юни подтянуть их модули и добавить поля к нашим
            let uniModule = uniModules.find(function(element) {
                    return element.number == parseInt(response.modules[module].disciplineNumberheaderCell);
                }) // response.modules[module].disciplineNumberheaderCell);
            if (uniModule != undefined) { // Надо как-то иначе объекты сливать, куча одинаковых строк - плохо
                response.modules[module].uuid = uniModule.uuid;
                response.modules[module].title = uniModule.title;
                response.modules[module].shortTitle = uniModule.shortTitle;
                response.modules[module].coordinator = uniModule.coordinator;
                response.modules[module].type = uniModule.type;
                response.modules[module].testUnits = uniModule.testUnits;
                response.modules[module].priority = uniModule.priority;
                response.modules[module].state = uniModule.state;
                response.modules[module].comment = uniModule.comment;
                response.modules[module].file = uniModule.file;
                response.modules[module].specialities = uniModule.specialities;

                for (var d = 0; d < response.modules[module].disciplines.length; d++) {
                    let uniDiscipline = uniModule.disciplines.find(function(element) {
                        if (response.modules[module].disciplines[d].disciplineNumberheaderCell.indexOf("______") >= 0) {
                            if (element.number != null) {
                                return element.number == parseInt(response.modules[module].disciplines[d].disciplineNumberheaderCell);
                            } else {
                                return response.modules[module].disciplines[d].titleheaderCell.indexOf(element.title) != -1
                            }
                        }
                    });
                    if (uniDiscipline != undefined) {
                        response.modules[module].disciplines[d].uuid = uniDiscipline.uuid;
                        response.modules[module].disciplines[d].title = uniDiscipline.title
                        response.modules[module].disciplines[d].section = uniDiscipline.section
                        response.modules[module].disciplines[d].file = uniDiscipline.file
                    }
                } // Здесь обновили дисчиплины
            };
        }

        delete response.disciplines;

        //На всякий случай лениво дампаем базу в файл. Трюкач
        try {
            var tableIds = tables.map(function(tableObj) {
                return tableObj["tableid"];
            });
            for (let i = 0; i < tableIds.length; i++) {
                var sqlDump = alasql('SELECT * INTO JSON(?) FROM ' + tableIds[i], [path.join(dumpDir, tableIds[i] + ".sql")]);
            }
        } catch (e) {
            console.log(e);
        }

        //Пишем рабочий json, который потом отправим на сервер
        fs.writeFileSync(path.join(resultDir, tableName + ".json"), JSON.stringify(response));
        console.log(tableName + ".json was saved!");
        //Перемещаем html файл в папку с отработанными файлами, пусть лежит там пока
        if (doneFiles) {
            fs.renameSync(path.join(dataDir, file), path.join(doneDir, file));
        }
        return JSON.stringify(response)
    } catch (e) {
        console.log(e);
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

function range(start, stop, step) {
    //Имплементация питонячьего range
    if (typeof stop == 'undefined') {
        // one param defined
        stop = start;
        start = 0;
    }
    if (typeof step == 'undefined') {
        step = 1;
    }
    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
        return [];
    }
    var result = [];
    for (var i = start; step > 0 ? i <= stop : i > stop; i += step) {
        result.push(i);
    }
    return result;
};