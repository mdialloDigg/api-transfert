const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'transfert-app');

const structure = {
  'server.js': `// Contenu complet de server.js (copie le code fourni précédemment)`,
  'package.json': `{
  "name": "transfert-app",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {"start":"node server.js"},
  "dependencies": {
    "bcryptjs":"^2.4.3",
    "express":"^4.18.2",
    "express-session":"^1.17.3",
    "mongoose":"^7.5.1",
    "pdfkit":"^0.13.0",
    "exceljs":"^4.3.0",
    "ejs":"^3.1.9"
  }
}`,
  'public': {
    'style.css': `/* Copie du contenu CSS fourni */`,
    'script.js': `/* Copie du contenu JS fourni */`,
    'form.html': `<!-- Copie du contenu HTML form fourni -->`
  },
  'views': {
    'list.ejs': `<!-- Copie du contenu list.ejs fourni -->`
  }
};

function createStructure(base, obj){
  if(!fs.existsSync(base)) fs.mkdirSync(base);
  for(let key in obj){
    const p = path.join(base,key);
    if(typeof obj[key]==='string') fs.writeFileSync(p,obj[key]);
    else createStructure(p,obj[key]);
  }
}

createStructure(baseDir, structure);
console.log('✅ Projet transfert-app créé avec succès !');
