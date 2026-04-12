const fs = require('fs');

const path = '/home/nebiyu/Desktop/Growth circle/ERP/server/src/config/swagger.ts';
let content = fs.readFileSync(path, 'utf8');

const newLoans = `'/api/loans/my': {
      get: {
        tags: ['Loans'],
        summary: 'Get logged-in user loans',
        description: 'Returns the loans for the currently authenticated user.',
        responses: { 
          200: { 
            description: 'Array of loans', 
          } 
        }
      },
    },
    '/api/loans': {`;

if (!content.includes("'/api/loans/my':")) {
  content = content.replace("'/api/loans': {", newLoans);
}

const newPenalties = `'/api/penalties/my': {
      get: {
        tags: ['Penalties'],
        summary: 'Get logged-in user penalties',
        description: 'Returns the penalties for the currently authenticated user.',
        responses: { 
          200: { 
            description: 'Array of penalties', 
          } 
        }
      },
    },
    '/api/penalties': {`;

if (!content.includes("'/api/penalties/my':")) {
  content = content.replace("'/api/penalties': {", newPenalties);
}

fs.writeFileSync(path, content);
console.log('Added my endpoints for loans and penalties to swagger.ts');
