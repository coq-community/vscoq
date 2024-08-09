import {PpString} from './types';

export const stringOfPpString = (pp:PpString) : string => {
    switch (pp[0]) {
        case "Ppcmd_empty":
            return "";
        case "Ppcmd_string":
            return pp[1];
        case "Ppcmd_glue":
            return pp[1].map(pp => stringOfPpString(pp)).join('');
        case "Ppcmd_box":
            return stringOfPpString(pp[2]);
        case "Ppcmd_tag":
            return stringOfPpString(pp[2]);
        case "Ppcmd_print_break":
            return " ".repeat(pp[1]);
        case "Ppcmd_force_newline":
            return "\n";
        case "Ppcmd_comment":
            return pp[1].join(' ');
    }
};