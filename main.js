// SVG Converter Main JavaScript
class SVGConverter {
    constructor() {
        this.inputEditor = null;
        this.outputEditor = null;
        this.init();
    }

    init() {
        this.initCodeEditors();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.updateStats();
    }

    initCodeEditors() {
        // Initialize CodeMirror for input
        this.inputEditor = CodeMirror.fromTextArea(document.getElementById('inputEditor'), {
            mode: 'xml',
            theme: 'material-palenight',
            lineNumbers: true,
            autoCloseTags: true,
            matchTags: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
        });

        // Initialize CodeMirror for output
        this.outputEditor = CodeMirror.fromTextArea(document.getElementById('outputEditor'), {
            mode: 'xml',
            theme: 'material-palenight',
            lineNumbers: true,
            readOnly: true,
            indentUnit: 2,
            tabSize: 2,
            lineWrapping: true,
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"]
        });

        // Auto-convert on input change
        this.inputEditor.on('change', () => {
            this.debounce(() => this.convertSVG(), 500)();
        });
    }

    setupEventListeners() {
        // File input
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.handleFileUpload(e);
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                switch(e.key) {
                    case 'Enter':
                        e.preventDefault();
                        this.convertSVG();
                        break;
                    case 'o':
                        e.preventDefault();
                        this.uploadFile();
                        break;
                    case 'c':
                        if (e.shiftKey) {
                            e.preventDefault();
                            this.copyOutput();
                        }
                        break;
                }
            }
        });
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('inputDropZone');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, this.highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, this.unhighlight, false);
        });

        dropZone.addEventListener('drop', this.handleDrop.bind(this), false);
        dropZone.addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    highlight(e) {
        document.getElementById('inputDropZone').classList.add('dragover');
    }

    unhighlight(e) {
        document.getElementById('inputDropZone').classList.remove('dragover');
    }

    handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            this.processFile(files[0]);
        }
    }

    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
    }

    processFile(file) {
        if (!file.name.toLowerCase().endsWith('.svg')) {
            this.showNotification('Please select an SVG file', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.inputEditor.setValue(e.target.result);
            this.showNotification(`Loaded ${file.name}`, 'success');
        };
        reader.readAsText(file);
    }

    convertSVG() {
        const svgContent = this.inputEditor.getValue().trim();
        if (!svgContent) {
            this.updateStatus('ready', 'Ready to convert');
            return;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(svgContent, 'image/svg+xml');
            
            // Check for parsing errors
            const parserError = doc.querySelector('parsererror');
            if (parserError) {
                throw new Error('Invalid SVG format');
            }

            const svg = doc.querySelector('svg');
            if (!svg) {
                throw new Error('No SVG element found');
            }

            const result = this.convertEmbeddedCSSToInline(svg, doc);
            
            // Update output
            const serializer = new XMLSerializer();
            const convertedSVG = serializer.serializeToString(svg);
            this.outputEditor.setValue(this.formatXML(convertedSVG));
            
            // Update preview
            this.updatePreview(convertedSVG);
            
            // Update conversion statistics
            this.updateConversionStats(result);
            
            // Update status
            this.updateStatus('success', `Converted ${result.convertedStyles} styles`);
            
        } catch (error) {
            console.error('Conversion error:', error);
            this.updateStatus('error', error.message);
            this.showNotification(`Conversion failed: ${error.message}`, 'error');
        }
    }

    convertEmbeddedCSSToInline(svg, doc) {
        let convertedStyles = 0;
        let processedElements = 0;
        
        // Find all style elements
        const styleElements = svg.querySelectorAll('style');
        const cssRules = [];

        // Extract CSS rules from style elements
        styleElements.forEach(styleEl => {
            const cssText = styleEl.textContent || styleEl.innerHTML;
            const rules = this.parseCSS(cssText);
            cssRules.push(...rules);
            
            // Remove the style element
            styleEl.parentNode.removeChild(styleEl);
        });

        // Apply CSS rules to elements
        cssRules.forEach(rule => {
            const elements = svg.querySelectorAll(rule.selector);
            elements.forEach(element => {
                this.applyStylesToElement(element, rule.styles);
                processedElements++;
            });
            convertedStyles++;
        });

        // Process elements with class attributes
        const elementsWithClass = svg.querySelectorAll('[class]');
        elementsWithClass.forEach(element => {
            const className = element.getAttribute('class');
            if (className) {
                // Look for matching CSS rules
                cssRules.forEach(rule => {
                    if (rule.selector === `.${className}` || 
                        rule.selector === `*[class~="${className}"]`) {
                        this.applyStylesToElement(element, rule.styles);
                        processedElements++;
                    }
                });
                
                // Remove class attribute after processing
                element.removeAttribute('class');
            }
        });

        return { convertedStyles, processedElements, cssRules };
    }

    parseCSS(cssText) {
        const rules = [];
        const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
        let match;

        while ((match = ruleRegex.exec(cssText)) !== null) {
            const selector = match[1].trim();
            const declarations = match[2].trim();
            
            if (selector && declarations) {
                const styles = this.parseStyleDeclarations(declarations);
                rules.push({ selector, styles });
            }
        }

        return rules;
    }

    parseStyleDeclarations(declarations) {
        const styles = {};
        const declarationsArray = declarations.split(';');
        
        declarationsArray.forEach(declaration => {
            const colonIndex = declaration.indexOf(':');
            if (colonIndex > 0) {
                const property = declaration.substring(0, colonIndex).trim();
                const value = declaration.substring(colonIndex + 1).trim();
                if (property && value) {
                    styles[property] = value;
                }
            }
        });

        return styles;
    }

    applyStylesToElement(element, newStyles) {
        // Get existing inline styles
        const existingStyle = element.getAttribute('style') || '';
        const existingStyles = this.parseInlineStyle(existingStyle);

        // Merge styles (new styles take precedence over existing ones)
        const mergedStyles = { ...existingStyles, ...newStyles };

        // Build style string
        const styleString = Object.entries(mergedStyles)
            .map(([prop, value]) => `${prop}:${value}`)
            .join(';');

        // Apply the merged style
        element.setAttribute('style', styleString);
    }

    parseInlineStyle(styleString) {
        const styles = {};
        if (!styleString) return styles;

        const declarations = styleString.split(';');
        declarations.forEach(declaration => {
            const colonIndex = declaration.indexOf(':');
            if (colonIndex > 0) {
                const property = declaration.substring(0, colonIndex).trim();
                const value = declaration.substring(colonIndex + 1).trim();
                if (property && value) {
                    styles[property] = value;
                }
            }
        });

        return styles;
    }

    formatXML(xmlString) {
        // Basic XML formatting
        return xmlString
            .replace(/></g, '>\n<')
            .replace(/(<\/[a-zA-Z0-9]+>)(<\/[a-zA-Z0-9]+>)/g, '$1\n$2')
            .replace(/(<[a-zA-Z0-9][^>]*>)(<[a-zA-Z0-9][^>]*>)/g, '$1\n  $2')
            .replace(/  (<\/[a-zA-Z0-9]+>)/g, '$1');
    }

    updatePreview(svgContent) {
        const previewContainer = document.getElementById('svgPreview');
        previewContainer.innerHTML = svgContent;
        
        // Scale the preview to fit
        const svg = previewContainer.querySelector('svg');
        if (svg) {
            svg.style.maxWidth = '100%';
            svg.style.maxHeight = '200px';
            svg.style.height = 'auto';
        }
    }

    updateStats() {
        const content = this.inputEditor.getValue();
        if (!content.trim()) {
            document.getElementById('cssRulesCount').textContent = '0';
            document.getElementById('elementsCount').textContent = '0';
            document.getElementById('classesCount').textContent = '0';
            return;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(content, 'image/svg+xml');
            const svg = doc.querySelector('svg');

            if (svg) {
                // Count CSS rules
                const styleElements = svg.querySelectorAll('style');
                let cssRulesCount = 0;
                styleElements.forEach(style => {
                    const cssText = style.textContent || style.innerHTML;
                    const rules = cssText.match(/[^{}]+\{[^{}]*\}/g) || [];
                    cssRulesCount += rules.length;
                });
                document.getElementById('cssRulesCount').textContent = cssRulesCount;

                // Count elements
                const elements = svg.querySelectorAll('*');
                document.getElementById('elementsCount').textContent = elements.length;

                // Count classes
                const elementsWithClass = svg.querySelectorAll('[class]');
                document.getElementById('classesCount').textContent = elementsWithClass.length;
            }
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    updateConversionStats(result) {
        document.getElementById('convertedStyles').textContent = result.convertedStyles;
        document.getElementById('processedElements').textContent = result.processedElements;
        
        const inputSize = this.inputEditor.getValue().length;
        const outputSize = this.outputEditor.getValue().length;
        const sizeChange = outputSize - inputSize;
        const sizeChangeText = sizeChange > 0 ? `+${sizeChange}` : `${sizeChange}`;
        document.getElementById('sizeChange').textContent = `${sizeChangeText} bytes`;
    }

    updateStatus(status, message) {
        const statusIndicator = document.getElementById('conversionStatus');
        const statusMessage = document.getElementById('conversionMessage');
        
        statusIndicator.className = `status-indicator status-${status}`;
        statusMessage.textContent = message;
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Public methods for UI buttons
    uploadFile() {
        document.getElementById('fileInput').click();
    }

    clearInput() {
        this.inputEditor.setValue('');
        this.outputEditor.setValue('');
        document.getElementById('svgPreview').innerHTML = '<p class="text-gray-500">SVG preview will appear here</p>';
        this.updateStatus('ready', 'Ready to convert');
        this.updateStats();
    }

    copyOutput() {
        const output = this.outputEditor.getValue();
        if (output) {
            navigator.clipboard.writeText(output).then(() => {
                this.showNotification('Copied to clipboard!', 'success');
            }).catch(() => {
                this.showNotification('Failed to copy', 'error');
            });
        } else {
            this.showNotification('No output to copy', 'warning');
        }
    }
}

// Global functions for UI buttons
function scrollToConverter() {
    document.getElementById('converter').scrollIntoView({ behavior: 'smooth' });
}

function loadExample() {
    const exampleSVG = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    .background { fill: #f0f0f0; }
    .circle { fill: #ff6b6b; stroke: #333; stroke-width: 2; }
    .rect { fill: #4ecdc4; stroke: #333; stroke-width: 2; }
    .highlight { opacity: 0.8; filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3)); }
  </style>
  
  <rect class="background" width="200" height="200"/>
  <circle class="circle highlight" cx="60" cy="60" r="40"/>
  <rect class="rect highlight" x="100" y="40" width="80" height="80"/>
  <text x="100" y="150" text-anchor="middle" class="highlight" style="font-family: Arial; font-size: 16px; fill: #333;">
    Hello SVG!
  </text>
</svg>`;
    
    if (window.svgConverter) {
        window.svgConverter.inputEditor.setValue(exampleSVG);
        window.svgConverter.showNotification('Example loaded!', 'success');
    }
}

function toggleTheme() {
    // Simple theme toggle (could be expanded)
    document.body.classList.toggle('dark');
}

// Initialize the converter when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.svgConverter = new SVGConverter();
    
    // Set up stats update interval
    setInterval(() => {
        if (window.svgConverter) {
            window.svgConverter.updateStats();
        }
    }, 1000);
});

// Smooth scrolling for navigation links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});
