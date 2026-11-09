// Node modules imported by shared code paths the mobile apps never run.
export const existsSync = () => false
export const readFileSync = () => ''
export const writeFileSync = () => {}
export default { existsSync, readFileSync, writeFileSync }
