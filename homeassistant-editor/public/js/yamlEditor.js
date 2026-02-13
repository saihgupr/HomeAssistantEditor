/**
 * YAML Editor Utilities
 * Handles indentation and other editor-specific logic.
 */
const YamlEditor = {
    /**
     * Processes Tab key presses for YAML indentation.
     * Pure function for testing.
     * @param {string} value - Current textarea value
     * @param {number} selectionStart - Cursor start
     * @param {number} selectionEnd - Cursor end
     * @param {boolean} shiftKey - Whether Shift is pressed
     * @returns {object|null} - Result object { value, selectionStart, selectionEnd } or null if not handled
     */
    processTabKey: function(value, selectionStart, selectionEnd, shiftKey) {
        // Single cursor, no shift: insert spaces
        if (selectionStart === selectionEnd && !shiftKey) {
            const spaces = '  ';
            const newValue = value.substring(0, selectionStart) + spaces + value.substring(selectionEnd);
            return {
                value: newValue,
                selectionStart: selectionStart + spaces.length,
                selectionEnd: selectionStart + spaces.length
            };
        }

        // Selection or Shift+Tab: Indent/Unindent lines
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
        let lineEnd = value.indexOf('\n', selectionEnd);
        
        if (selectionEnd > 0 && value[selectionEnd-1] === '\n' && selectionEnd !== selectionStart) {
            lineEnd = selectionEnd - 1;
        }
        
        if (lineEnd === -1) lineEnd = value.length;

        const blockStart = lineStart;
        const blockEnd = lineEnd;
        
        const textBefore = value.substring(0, blockStart);
        const block = value.substring(blockStart, blockEnd);
        const textAfter = value.substring(blockEnd);
        
        const lines = block.split('\n');
        let hasChanges = false;
        
        const newLines = lines.map(line => {
            if (shiftKey) {
                if (line.startsWith('  ')) {
                    hasChanges = true;
                    return line.substring(2);
                } else if (line.startsWith(' ')) {
                    hasChanges = true;
                    return line.substring(1);
                }
                return line;
            } else {
                hasChanges = true;
                return '  ' + line;
            }
        });
        
        if (!hasChanges && shiftKey) return null;

        const newBlock = newLines.join('\n');
        const newValue = textBefore + newBlock + textAfter;
        
        return {
            value: newValue,
            selectionStart: blockStart,
            selectionEnd: blockStart + newBlock.length
        };
    },

    /**
     * Enables YAML indentation on a textarea element.
     * @param {HTMLTextAreaElement} textarea 
     */
    enableIndentation: function(textarea) {
        if (!textarea || textarea.dataset.indentListenerAttached) return;

        textarea.addEventListener('keydown', (e) => {
            // Check for Tab key (standard 'Tab' or legacy keyCode 9)
            if (e.key === 'Tab' || e.keyCode === 9) {
                // console.log('YAML Editor Tab pressed');
                
                const result = this.processTabKey(
                    textarea.value,
                    textarea.selectionStart,
                    textarea.selectionEnd,
                    e.shiftKey
                );

                if (result) {
                    e.preventDefault();
                    e.stopImmediatePropagation(); // Be extremely aggressive
                    e.stopPropagation(); 
                    
                    // Use execCommand for undo history support if possible
                    if (document.queryCommandSupported('insertText') && !e.shiftKey && textarea.selectionStart === textarea.selectionEnd) {
                         document.execCommand('insertText', false, '  ');
                    } else {
                        textarea.value = result.value;
                        textarea.selectionStart = result.selectionStart;
                        textarea.selectionEnd = result.selectionEnd;
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else if (e.shiftKey) {
                    // Always prevent default on Shift+Tab to avoid focus loss even if no indentation change
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                }
            }
        }, { capture: true }); 

        textarea.dataset.indentListenerAttached = 'true';
    }
};

// Global listener as a backup if for some reason the individual listeners are failing
window.addEventListener('keydown', function(e) {
    if ((e.key === 'Tab' || e.keyCode === 9) && 
        (e.target.id === 'yaml-content' || e.target.id === 'block-yaml-content')) {
        
        // If the individual listener didn't catch it (maybe it wasn't attached?)
        // handle it here.
        if (!e.target.dataset.indentListenerAttached) {
            YamlEditor.enableIndentation(e.target);
            // We can't prevent default for THIS event if it already reached here and was bubble,
            // but we can try.
            const result = YamlEditor.processTabKey(
                e.target.value,
                e.target.selectionStart,
                e.target.selectionEnd,
                e.shiftKey
            );
            if (result) {
                e.preventDefault();
                e.stopImmediatePropagation();
                e.target.value = result.value;
                e.target.selectionStart = result.selectionStart;
                e.target.selectionEnd = result.selectionEnd;
                e.target.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
}, { capture: true });

window.YamlEditor = YamlEditor;
