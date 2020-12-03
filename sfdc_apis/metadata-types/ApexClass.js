let restAPI = require('../rest');
const logError = require('../../services/logging');
let utils = require('../../services/utils');


async function findReferences(connection,entryPoint,cache,options){

    let references = [];
    let restApi = restAPI(connection);

    let metadataTypeRecords = [];

    try {
        metadataTypeRecords = await findMetadataTypeRecords();
    } catch (error) {
        logError('Error while finding metadata type records',{entryPoint,error});
    }

    references.push(
        ...metadataTypeRecords
    );

    return references;

    async function findMetadataTypeRecords(){

        let metadataTypesUsingClass = [];
        if(!options.classInMetadataTypes) return metadataTypesUsingClass;

        function parseMetadataTypeRecord(record){

            let simplified = {
                name: `${record.DeveloperName} (from ${record.matchingField})` ,
                type: record.attributes.type,
                id: record.Id,
                url:`${connection.url}/${record.Id}`,
                notes:null,       
            }
            return simplified;
        }

        let searchValue = entryPoint.name.toLowerCase();

        //we need to get all the objects in the org to find
        //out which ones are actually custom metadata types
        let sObjects = await restApi.getSObjectsDescribe();
        let customMetadataTypes = [];
        
        sObjects.forEach(sobj => {
            //metadata types end with __mdt
            if(sobj.name.includes('__mdt')){

                //once we have identified a custom metadata type, we need to find its id
                //by querying the customObject object of the tooling API

                //for some reason this API expects the object name to be passed without
                //a namespace prefix and without the __mdt suffix, so we have to remove
                //both of this here

                let name;
                let indexOfPrefix = sobj.name.indexOf('__');
                let indexOfSuffix = sobj.name.indexOf('__mdt');

                if(indexOfPrefix == indexOfSuffix){
                    //if it's the same, there there's only 1, which by
                    //default would be the suffix, so we remove it
                    name = sobj.name.substring(0,indexOfSuffix);
                }
                else{
                    //remove the suffix
                    name = sobj.name.substring(0,indexOfSuffix);     
                    //remove the prefix
                    name = name.substring(indexOfPrefix+2);
                }

                customMetadataTypes.push(name);
            }
        });

        //it's possible that the org doesn't have metadata types
        //so we exit early
        if(customMetadataTypes.length){

            let filterNames = utils.filterableId(customMetadataTypes);

            //the sobjects describe call from the rest API that we did earlier doesn't include
            //the object id, so we need to query it here manually
            //this will then be used to query all the custom fields that belong to a specific metadata type
            let query = `SELECT Id,DeveloperName,NamespacePrefix FROM CustomObject WHERE DeveloperName  IN ('${filterNames}')`;
            let soql = {query,filterById:false,useToolingApi:true};
            let rawResults = await restApi.query(soql);

            let metadataTypesById = new Map();

            rawResults.records.map(obj => {
                if(obj.NamespacePrefix){
                    obj.DeveloperName = `${obj.NamespacePrefix}__${obj.DeveloperName}`;
                }
                obj.DeveloperName += '__mdt';
                metadataTypesById.set(obj.Id,obj.DeveloperName);
            });

            let filterTableOrEnumIds = utils.filterableId(Array.from(metadataTypesById.keys()));

            //now we query all the custom fields belonging to custom metadata types
            query = `SELECT Id,DeveloperName,TableEnumOrId,NamespacePrefix FROM CustomField WHERE TableEnumOrId  IN ('${filterTableOrEnumIds}')`;
            soql = {query,filterById:false,useToolingApi:true};

            rawResults = await restApi.query(soql);

            let fullFieldNames = [];

            //once we have all the fields, we build their full name using the metadata type
            //id map. Ideally we would've queried the full name in the previous query but
            //the tooling API doesn't allow queries on the fullName if the query returns
            //more than one result
            rawResults.records.forEach(field => {

                //the reason we add the field prefix using the field object itself and not the
                //the prefix from owning metadata type is because the field may not have
                //the same prefix as its owning metadata type. This can happen if the metadata type
                //is from an unlocked package, but the field was created manually on top of that metadata type
                //which would result in the field not having a namespace
                //so we add the namespace based on the actual namespace of the field and not under the assumption
                //that it has the same namespace as its parent*/

                let metadataTypeName = metadataTypesById.get(field.TableEnumOrId);
                
                if(field.NamespacePrefix){
                    field.DeveloperName = `${field.NamespacePrefix}__${field.DeveloperName}`;
                }

                let fullFieldName = `${metadataTypeName}.${field.DeveloperName}__c`;
                fullFieldNames.push(fullFieldName);
            });

            let fieldsThatReferenceClasses = [];
            //we assume that any field that has any of these identifiers
            //in its name, could possibly hold a value that matches the apex class name
            let classIndentifiers = ['class','handler','type','instance','trigger'];

            fullFieldNames.forEach(field => {

                //when checking if the field has any of the identifiers, we need
                //to check only the field name, excluding the object name
                //this prevents false positives like trigger_handler__mdt.not_valid__c
                //where it's the object name that matches the identifier, as opposed to the
                //actual field nae
                let fieldName = field.split('.')[1].toLowerCase();

                let fieldHasIndentifier = classIndentifiers.some(ci => {
                    return fieldName.includes(ci);
                });
                if(fieldHasIndentifier){
                    //however here, we push the entire field name
                    fieldsThatReferenceClasses.push(field);
                }
            })

            //now we have the objects and fields that point to a class
            //The next step is to query each individual object, checking if the field in question
            //matches the search value
            //to do that, we map the fields by the object name
            //note that a single metadata type can have multiple fields that point to field definitions
            let fieldsByObjectName = new Map();

            fieldsThatReferenceClasses.forEach(field => {

                let [objectName,fieldName] = field.split('.');
                
                if(fieldsByObjectName.get(objectName)){
                    fieldsByObjectName.get(objectName).push(fieldName);
                }
                else{
                    fieldsByObjectName.set(objectName,[fieldName]);
                }

            });

            let queries = [];

            //we need to build on query per field because you can't use OR in custom metadata
            //types SOQL
            for (let [objectName, fields] of fieldsByObjectName) {
     
                fields.forEach(field => {
                    let query = `SELECT Id , ${field}, DeveloperName FROM ${objectName} WHERE ${field} != null`;
                    queries.push(query);
                });
            }

            //once we have all the queries, we 
            //execute them in parallel
            let data = await Promise.all(

                queries.map(async (query) => {

                    let soql = {query,filterById:false}
                    try {
                        //sometimes a query can fail for example if we try to filter via
                        //a long text area field. We ignore these errors and move on to quers
                        //other records
                        let rawResults = await restApi.query(soql); 
                        return rawResults.records;
                    } catch (error) {
                        return [];
                    }
                })
            )

            let allData = [];
            data.forEach(d => allData.push(...d));

            allData.forEach(record => {

                //now we go through the results
                //if the record has a key, whos value matches the search value, we 
                //consider this a match
                //we do this because as explained earlier, a single record can have multiple
                //fields that hold an apex class name. So rather than keeping track of all the
                //fields per object, we just check if a key value matches the search value
                Object.keys(record).forEach(key => {
                    if(typeof record[key] === 'string' && record[key].toLowerCase() == searchValue){
                        record.matchingField = key;
                        metadataTypesUsingClass.push(parseMetadataTypeRecord(record));
                    }
                })
            })            
        }
        return metadataTypesUsingClass;

    } 
}



module.exports = findReferences;