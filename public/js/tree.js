import {foldersApi} from './folders.js';


function createDependencyTree(tree,targetElement) {

    for (let topKey in tree) {
    
      //here we create the icon and name for the top node
      let topMetadataName = document.createTextNode(` ${topKey}`);
  
      targetElement.appendChild(foldersApi.createFolderIcon(true));
      targetElement.appendChild(topMetadataName);
  
      let treeBody = tree[topKey];
  
      //if the metadata has dependencies/references, we create
      //a node for each
      if (treeBody.references) {
        createTreeNodes(treeBody.references, targetElement);
      }
    }
}

function createUsageTree(tree,targetElement){

  let metadataTypesList = document.createElement('ul');
  targetElement.appendChild(metadataTypesList);

  for(let metadataType in tree){

    let metadataTypeNode = document.createElement('li');

    metadataTypesList.appendChild(metadataTypeNode);

    metadataTypeNode.appendChild(foldersApi.createFolderIcon());
    metadataTypeNode.appendChild(document.createTextNode(` ${metadataType}`));

    tree[metadataType].forEach(member => {
      createMemberNode(metadataTypeNode,member);
    });
  }

}

function createTreeNodes(refs,parentNode){

    let childNodes = document.createElement('ul');
    
    parentNode.appendChild(childNodes);
  
    for(let mdType in refs){
  
        let metadataTypeNode = document.createElement('li');
        childNodes.appendChild(metadataTypeNode);
  
        //create folder icon for this specific metadata type
        metadataTypeNode.appendChild(foldersApi.createFolderIcon());
        metadataTypeNode.appendChild(document.createTextNode(` ${mdType}`));
  
        refs[mdType].forEach(member => {
          createMemberNode(metadataTypeNode,member);
        });
    }
  }
  
  function createMemberNode(metadataTypeNode,member){
  
    let memberNames = document.createElement('ul');
    memberNames.style.display = 'none';
    let memberNodeName = document.createElement('li');
  
    let memberName = document.createElement('a');
    memberName.setAttribute('href',member.url);
    memberName.setAttribute('target','_blank');
    memberName.innerText = ` ${member.name}`;
    
    memberNodeName.appendChild(createMemberIcon());
    memberNodeName.appendChild(memberName);

    if(member.namespace){
      memberNodeName.appendChild(createWarningIcon());
    }
  
    memberNames.appendChild(memberNodeName);
    metadataTypeNode.appendChild(memberNames);
  
    if(member.references){
        createTreeNodes(member.references,memberNodeName);
    }
  }
  
  function createMemberIcon(){

    let memberIcon = document.createElement('i');
    memberIcon.classList.add(...['fa','fa-code']);
    return memberIcon;
  }

  function createWarningIcon(){
    let warningIcon = document.createElement('i');
    warningIcon.classList.add('fa', 'fa-exclamation-triangle');
    return warningIcon;
  }

  export const treeApi = {
    createDependencyTree,createUsageTree
  };