import re

with open('config/prompts/model_answer_system_prompt.ts', 'r') as f:
    content = f.read()

lines = content.split('\n')
new_lines = []
inside_template = False

for i, line in enumerate(lines):
    ln = i + 1
    if ln == 1 and 'export default `' in line:
        inside_template = True
        new_lines.append(line)
        continue
    if inside_template and line.strip() == '`;':
        inside_template = False
        new_lines.append(line)
        continue
    # Fix lines 51-71 that have bare backtick code spans inside the template literal
    if inside_template and 51 <= ln <= 71:
        # Replace inline code backtick spans with escaped versions
        fixed = re.sub(r'`([^`\n]*)`', r'\\\\\\`\1\\\\\\`', line)
        new_lines.append(fixed)
    else:
        new_lines.append(line)

with open('config/prompts/model_answer_system_prompt.ts', 'w') as f:
    f.write('\n'.join(new_lines))

print('Done. Fixed lines 51-71 backtick escaping.')
