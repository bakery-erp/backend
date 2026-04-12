const fs = require('fs');

function addSubmitState(filePath, functionsToFix) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (!content.includes('isSubmitting')) {
    content = content.replace(/const \[isLoading, setIsLoading\] = useState\(true\);/g, 
        'const [isLoading, setIsLoading] = useState(true);\n  const [isSubmitting, setIsSubmitting] = useState(false);');
  }

  for (const func of functionsToFix) {
    const startStr = `const ${func} = async (`;
    if (content.includes(startStr)) {
        content = content.replace(
            new RegExp(`const ${func} = async \\((.*?)\\) => \\{\\s*e\\.preventDefault\\(\\);`, 'g'),
            `const ${func} = async ($1) => {\n    e.preventDefault();\n    setIsSubmitting(true);`
        );
        
        let lastCatchIndex = 0;
        let c = content;
        // Simple regex replace for finally block addition. This is risky, a better way is a manual script replacement.
    }
  }
}
