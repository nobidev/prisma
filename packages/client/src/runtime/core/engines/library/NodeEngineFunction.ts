import { JsonFieldSelection } from '../common/types/JsonProtocol'

const getModelFieldDefinitionByFieldX = (x, modelFields, resultFieldX) => {
  // console.log('getModelFieldDefinitionByFieldX by ', x, ' for ', resultFieldX)
  for (const modelField in modelFields) {
    if (Object.prototype.hasOwnProperty.call(modelFields, modelField)) {
      // console.log('-', modelField, modelFields[modelField])

      if (modelFields[modelField][x] == resultFieldX) {
        // console.log('modelFieldDefinition found: ', modelFields[modelField])
        return modelFields[modelField]
      }
    }
  }
}
const getModelFieldDefinitionByFieldName = (modelFields, resultFieldName) => {
  return getModelFieldDefinitionByFieldX('name', modelFields, resultFieldName)
}
const getModelFieldDefinitionByFieldRelatioName = (modelFields, resultFieldRelationName) => {
  return getModelFieldDefinitionByFieldX('relationName', modelFields, resultFieldRelationName)
}
const getModelFieldDefinitionByFieldDbName = (modelFields, resultFieldDbName) => {
  return getModelFieldDefinitionByFieldX('dbName', modelFields, resultFieldDbName)
}
const getModelFieldDefinitionByFieldIsId = (modelFields) => {
  return getModelFieldDefinitionByFieldX('isId', modelFields, true)
}

export const executeViaNodeEngine = (libraryEngine, query) => {
  // console.log('Yes, NodeEngine!')
  // console.dir({ query }, { depth: null })

  // "dmmf" like object that has information about datamodel
  // console.dir({ _runtimeDataModel: this.config._runtimeDataModel }, { depth: null })

  const executingQueryPromise = (async () => {
    // get table name via "dmmf"
    const modelName = query.modelName
    const tableName = libraryEngine.config._runtimeDataModel.models[modelName!].dbName || modelName // dbName == @@map
    // console.log({tableName})

    // get table fields
    // TODO consider @map
    const modelFields = libraryEngine.config._runtimeDataModel.models[modelName!].fields
    // console.log({modelFields})

    let sql = ''

    if (query.query.selection._count) {
      sql = handleCountAggregations(query, modelFields, libraryEngine, tableName)
    } else {
      sql = `SELECT * FROM "${tableName}"`
    }
    // console.log({sql})

    try {
      const result = await libraryEngine.adapter.queryRaw({ sql, args: [] })
      // console.dir({ result }, { depth: null })

      // LOG SQL
      if (libraryEngine.logQueries) {
        libraryEngine.logEmitter.emit('query', {
          timestamp: new Date(),
          query: sql,
          params: 'none', // TODO params
          duration: Number(0), // TODO measure above
          target: 'huh?', // TODO what is this even?
        })
        console.log('nodeQuery', sql)
      }

      // INTERNAL: combine separated keys and values from driver adapter
      const combinedResult = result.value.rows.map((row) => {
        const obj = {}
        result.value.columnNames.forEach((colName, index) => {
          obj[colName] = row[index]
        })
        return obj
      })
      // console.log({combinedResult})

      // RESULT VALUE TYPE INDICATION
      // turn returned data into expected format (with type indications for casting in /packages/client/src/runtime/core/jsonProtocol/deserializeJsonResponse.ts)
      // TODO Long term most of this should not be necessary at all, as it is just from a to b and then back to a
      let transformedData = combinedResult.map((resultRow) => {
        // iterate over all fields of the row
        for (const resultFieldName in resultRow) {
          if (Object.prototype.hasOwnProperty.call(resultRow, resultFieldName)) {
            // console.dir(`${resultFieldName}: ${resultRow[resultFieldName]}`);

            const modelFieldDefinition = getModelFieldDefinitionByFieldName(modelFields, resultFieldName)
            if (modelFieldDefinition) {
              const type = modelFieldDefinition.type
              if (resultRow[resultFieldName] != null) {
                // field is not empty
                if (type == 'DateTime') {
                  resultRow[resultFieldName] = { $type: 'DateTime', value: resultRow[resultFieldName] }
                } else if (type == 'BigInt') {
                  resultRow[resultFieldName] = { $type: 'BigInt', value: resultRow[resultFieldName] }
                } else if (type == 'Bytes') {
                  resultRow[resultFieldName] = { $type: 'Bytes', value: resultRow[resultFieldName] }
                } else if (type == 'Decimal') {
                  resultRow[resultFieldName] = { $type: 'Decimal', value: resultRow[resultFieldName] }
                }
              }
            }
          }
        }

        return resultRow
      })

      // TRANSFORM AGGREGATIONS
      // console.log("data before transformation", transformedData)
      transformedData = transformedData.map((resultRow) => {
        for (const resultFieldName in resultRow) {
          if (Object.prototype.hasOwnProperty.call(resultRow, resultFieldName)) {
            // console.dir(`${resultFieldName}: ${resultRow[resultFieldName]}`);

            // _count
            if (resultFieldName.startsWith('_aggr_count_')) {
              const countKey = resultFieldName.replace('_aggr_count_', '')
              if (!resultRow._count) {
                resultRow._count = {}
              }
              resultRow._count[countKey] = Number(resultRow[resultFieldName])
              delete resultRow[resultFieldName]
            }
          }
        }
        return resultRow
      })
      // console.log("data before transformation", transformedData)

      // @map FIELD RENAMING
      // console.log({ modelFields })
      transformedData = transformedData.map((resultRow) => {
        for (const resultFieldName in resultRow) {
          if (Object.prototype.hasOwnProperty.call(resultRow, resultFieldName)) {
            // console.dir(`${key}: ${row[key]}`);

            const modelFieldDefinition = getModelFieldDefinitionByFieldDbName(modelFields, resultFieldName)
            // console.log({ modelFieldDefinition })
            if (modelFieldDefinition && modelFieldDefinition.name) {
              // TODO do this in a way that the order of fields is not changed
              resultRow[modelFieldDefinition.name] = resultRow[resultFieldName]
              delete resultRow[resultFieldName]
            }
          }
        }
        return resultRow
      })

      return transformedData
    } catch (error) {
      throw new Error(error)
    }
  })()

  return executingQueryPromise
}

function handleCountAggregations(query: any, modelFields: any, libraryEngine: any, tableName: any) {
  /*
    model Link {
      id        String   @id @default(uuid())
      user      User?    @relation(fields: [userId], references: [id])
      userId    String?
    }
    model User {
      id        String    @id @default(uuid())
      links     Link[]
    }

    =>
    _count: { arguments: {}, selection: { links: true } }
  */

  const selections = Object.keys((query.query.selection._count as JsonFieldSelection).selection)

  // arrays to store generated data to add to the SQL statement
  const _additionalSelections: String[] = []
  const _additionalJoins: String[] = []

  // loop over all selections
  // const relationToCount = selections[0] // 'links`
  for (let i = 0; i < selections.length; i++) {
    const relationToCount = selections[i]
    // get information from current model
    const relationToCountFieldDefinition = getModelFieldDefinitionByFieldName(modelFields, relationToCount) // links object

    // console.log({relationToCountFieldDefinition})
    // PART 1: additional selection string
    const relationToCountModelname = relationToCountFieldDefinition.type // 'Link'
    const relationToCountTablename = relationToCountModelname // TODO Actually get the table name for target model, not just the type of the relation
    const _selectionString = `COALESCE("aggr_selection_${i}_${relationToCountTablename}"."_aggr_count_${relationToCount}", 0) AS "_aggr_count_${relationToCount}"`
    _additionalSelections.push(_selectionString)

    // PART 2: additional JOIN
    // get information from model the relation points to
    const relationToCountModelFields = libraryEngine.config._runtimeDataModel.models[relationToCountModelname!].fields
    // console.dir({ relationToCountModelname, relationToCountModelFields }, { depth: null })
    const targetModelFieldDefinition = getModelFieldDefinitionByFieldRelatioName(
      relationToCountModelFields,
      relationToCountFieldDefinition.relationName,
    )
    const aggregationTargetType = targetModelFieldDefinition.type // 'User'
    const relationFromField = targetModelFieldDefinition.relationFromFields[0] // this only has content for 1-n, not m-n

    // console.log({ relationFromField })
    // primary key from first table for sql
    const aggregationTargetTypeIdField = getModelFieldDefinitionByFieldIsId(modelFields)
    // console.log({ aggregationTargetTypeIdField })
    const aggregationTargetTypeIdFieldName = aggregationTargetTypeIdField.name // User.uid

    // console.log( { aggregationTargetTypeIdFieldName })
    if (relationFromField) {
      // 1-n
      const _joinString = `LEFT JOIN
                  (SELECT "${relationToCountTablename}"."${relationFromField}",
                          COUNT(*) AS "_aggr_count_${relationToCount}"
                  FROM "${relationToCountTablename}"
                  WHERE 1=1
                  GROUP BY "${relationToCountTablename}"."${relationFromField}") 
                    AS "aggr_selection_${i}_${relationToCountTablename}" 
                    ON ("${aggregationTargetType}".${aggregationTargetTypeIdFieldName} = "aggr_selection_${i}_${relationToCountTablename}"."${relationFromField}")
            `
      _additionalJoins.push(_joinString)
    } else {
      // m-n
      // need to get the primary key so we can properly join
      const relationToCountTypeIdField = getModelFieldDefinitionByFieldIsId(relationToCountModelFields) // User details
      console.log({ relationToCountTypeIdField })
      const relationToCountTypeIdFieldName = relationToCountTypeIdField.name // User.uid
      console.log({ relationToCountTypeIdFieldName })

      // Correctly select A and B to match model/table names of relation
      const char1 = relationToCountTablename.charAt(0)
      const char2 = tableName.charAt(0)
      const [mainForeignKeyName, otherForeignKeyName] =
        char1.charCodeAt(0) < char2.charCodeAt(0) ? ['B', 'A'] : ['A', 'B']

      const _joinString = `
                LEFT JOIN
                  (SELECT "_${relationToCountFieldDefinition.relationName}"."${mainForeignKeyName}",
                          COUNT(("_${relationToCountFieldDefinition.relationName}"."${mainForeignKeyName}")) AS "_aggr_count_${relationToCount}"
                    FROM "${relationToCountTablename}"
                    LEFT JOIN "_${relationToCountFieldDefinition.relationName}" ON ("${relationToCountTablename}"."${relationToCountTypeIdFieldName}" = ("_${relationToCountFieldDefinition.relationName}"."${otherForeignKeyName}"))
                    WHERE 1=1
                    GROUP BY "_${relationToCountFieldDefinition.relationName}"."${mainForeignKeyName}") 
                      AS "aggr_selection_${i}_${relationToCountTablename}" 
                      ON ("${aggregationTargetType}"."${aggregationTargetTypeIdFieldName}" = "aggr_selection_${i}_${relationToCountTablename}"."${mainForeignKeyName}")
          `
      _additionalJoins.push(_joinString)
    }
  }

  const sql = `SELECT "${tableName}".*, 
            ${_additionalSelections.join(',\n')}
          FROM "${tableName}"
            ${_additionalJoins.join('\n')}
          WHERE 1=1
            OFFSET 0`
  return sql
}