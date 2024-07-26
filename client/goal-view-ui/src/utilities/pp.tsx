import { FunctionComponent, ReactFragment, useRef, useState, useEffect, useLayoutEffect} from 'react';
import useResizeObserver from '@react-hook/resize-observer';
import {ResizeObserverEntry} from '@juggle/resize-observer';
import { v4 as uuid } from 'uuid';

import { PpString, PpMode, BoxDisplay, Term, Break, Box, DisplayType, BreakInfo } from '../types';
import PpBreak from './pp-break';
import PpBox from './pp-box';

import classes from './Pp.module.css';
import { off } from 'process';


const MAX_RECOMPUTE = 50;

type PpProps = {
    pp: PpString;
    coqCss: CSSModuleClasses;
    maxDepth: number;
};

type DisplayState = {
    breakIds: BreakInfo[];
    display: Box | null;
};

const ppDisplay : FunctionComponent<PpProps> = (props) => {
    
    const {pp, coqCss, maxDepth} = props;
    
    const [numRecomputes, setNumRecomputes] = useState<number>(0);
    const [maxBreaks, setMaxBreaks] = useState<number>(0);
    const [displayState, setDisplayState] = useState<DisplayState>({breakIds: [], display: null});
    const [lastEntry, setLastEntry] = useState<ResizeObserverEntry|null>(null);
    const [hovered, setHovered] = useState<boolean>(false);
    useEffect(() => {
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    const onKeyDown = (e : KeyboardEvent) => {
        if(e.altKey) {
            setHovered(true);
        }
    };

    const onKeyUp = (_: KeyboardEvent) => {
        setHovered(false);
    };


    const container = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLSpanElement>(null);

    useResizeObserver(container, (entry) => {
        
        if(container.current) {
            if(content.current) {
                //in this case the window has already been resized
                if(lastEntry) {

                    //don't trigger a recomputation for small resizes
                    if(Math.abs(entry.contentRect.width - lastEntry.contentRect.width) <= 10) {return;}
                    
                    //When we enlarge the window we should try and recompute boxes
                    if(entry.contentRect.width > lastEntry.contentRect.width) {
                        //Reinit breaks
                        setDisplayState(ds => {
                            return {
                                ...ds,
                                breakIds: []
                            };
                        });
                    } else {
                        computeNeededBreaks(maxBreaks);
                    }
                } else {
                    computeNeededBreaks(maxBreaks);
                }
            }
        }
        setLastEntry(entry);
    });

    useEffect(() => {
        const breaks = computeNumBreaks(pp, 0);
        setNumRecomputes(0);
        setMaxBreaks(breaks);
        setDisplayState({
            breakIds: [],
            display: boxifyPpString(pp)
        });
        computeNeededBreaks(breaks);
    }, [pp]);

    useLayoutEffect(() => {
        if(numRecomputes < MAX_RECOMPUTE) {
            computeNeededBreaks(maxBreaks);
            setNumRecomputes(numRecomputes + 1);
        }
    }, [displayState]);

    const getPpTag  = (pp: PpString, tag: string, indent: number, mode: PpMode, depth: number) => {
        const id = uuid();
        switch(pp[0]) {
            case 'Ppcmd_empty':
                console.error('Received PpTag with empty');
                return null;
            case 'Ppcmd_string':
                return {
                    type: DisplayType.term,
                    classList: [classes.Tag, tag],
                    content: pp[1]
                } as Term;
            case 'Ppcmd_glue':
                return {
                    id: "box-"+id,
                    type: DisplayType.box,
                    mode: mode,
                    classList: [tag],
                    indent: indent,
                    boxChildren: flattenGlue(pp[1], mode, indent, id, depth + 1)
                } as Box;
            case 'Ppcmd_force_newline':
                console.error('Received PpTag with fnl');
                return null;
            case 'Ppcmd_comment':
                console.error('Received PpTag with comment');
                return null;
            case 'Ppcmd_box':
                const m = pp[1][0];
                const i = (m !== PpMode.horizontal) ? pp[1][1] : 0;
                return {
                    id: "box-"+id,
                    type: DisplayType.box,
                    mode: mode,
                    classList: [tag],
                    indent: indent,
                    boxChildren: getBoxChildren(pp[2], m, i, id, depth + 1)
                } as Box;
            case 'Ppcmd_tag':
                console.error('Received PpTag with tag');
                return null;
            case 'Ppcmd_print_break':
                console.error('Received PpTag with br');
                return null;
        }
    };

    const flattenGlue = (glue: PpString[], mode: PpMode, indent: number, boxId: string, depth: number) : BoxDisplay[] => {

        const g = glue.map(pp => {
            switch(pp[0]) {
                case 'Ppcmd_empty':
                    return [];
                case 'Ppcmd_string':
                    return [{
                        type: DisplayType.term,
                        classList: [classes.Text],
                        content: pp[1]
                    } as Term];
                case 'Ppcmd_glue':
                        return flattenGlue(pp[1], mode, indent, boxId, depth);
                case 'Ppcmd_force_newline':
                    return [{
                        id: "fnl",
                        type: DisplayType.break,
                        offset: 0,
                        mode: mode,
                        horizontalIndent: 0, 
                        indent: indent,
                        shouldBreak: true,
                    } as Break];
                case 'Ppcmd_comment':
                    return [];
                case 'Ppcmd_box':
                    return [boxifyPpString(pp, depth)];
                case 'Ppcmd_tag':
                    return [getPpTag(pp[2], coqCss[pp[1].replaceAll(".", "-")], indent, mode, depth)];
                case 'Ppcmd_print_break':
                    const brId = uuid();
                    return [{
                        id: "box-"+boxId+"break-"+brId,
                        type: DisplayType.break,
                        offset: 0,
                        mode: mode,
                        horizontalIndent: pp[1],
                        indent: indent,
                        shouldBreak: false
                    } as Break];
            }
        });
        const r = g.reduce((acc, curr) => {
            return acc.concat(curr);
        }, []);

        return r;
    };

    const getBoxChildren = (pp : PpString, mode: PpMode, indent: number, boxId: string, depth: number) : BoxDisplay[] => {
        switch(pp[0]) {
            case "Ppcmd_empty":
                return [];
            case "Ppcmd_glue":
                return flattenGlue(pp[1], mode, indent, boxId, depth);
            case 'Ppcmd_string':
                return [{
                    type: DisplayType.term,
                    classList: [classes.Text],
                    content: pp[1]
                } as Term];
            case 'Ppcmd_force_newline':
                return [];
            case 'Ppcmd_comment':
                return [];
            case 'Ppcmd_box':
                return [
                    boxifyPpString(pp, depth)
                ];
            case 'Ppcmd_tag':
                return [
                    getPpTag(pp[2], coqCss[pp[1].replaceAll(".", "-")], indent, mode, depth)
                ];
            case 'Ppcmd_print_break':
                return [];
        }
    };

    const boxifyPpString = (pp : PpString, depth : number = 0) => {
        const id = uuid();
        switch (pp[0]) {
            case 'Ppcmd_empty':
            case 'Ppcmd_string':
            case 'Ppcmd_glue':
            case 'Ppcmd_force_newline':
            case 'Ppcmd_comment':
            case 'Ppcmd_tag':
            case 'Ppcmd_print_break':
                console.log('Goal contains non-boxed PpString');
                return {
                    id: "box-"+id,
                    type: DisplayType.box,
                    depth: depth,
                    classList: [],
                    mode: PpMode.hovBox,
                    indent: 0,
                    boxChildren: getBoxChildren(pp, PpMode.hovBox, 0, id, depth + 1)
                } as Box;
            case 'Ppcmd_box':
                const mode = pp[1][0];
                const indent = (mode !== PpMode.horizontal) ? pp[1][1] : 0;
                return {
                    id: "box-"+id,
                    type: DisplayType.box,
                    depth: depth,
                    mode: mode,
                    classList: [],
                    indent: indent,
                    boxChildren: getBoxChildren(pp[2], mode, indent, id, depth + 1)
                } as Box;
        }
    };

    const computeNeededBreaks = (maxBreaks: number) => {
        if(container.current) {
            if(content.current) {
                const containerRect = container.current.getBoundingClientRect();
                const contentRect = content.current.getBoundingClientRect();
                if(containerRect.width < contentRect.width) {
                    if(displayState.breakIds.length < maxBreaks) {
                        checkBreaks(containerRect.width);
                    }
                }
            }
        }

    };

    const checkBreaks = (containerWidth: number) => {
        if(content.current) {
            let breakInfo : BreakInfo | null = null;
            const boxes = content.current.querySelectorAll("."+classes.Box);
            
            for(let box of boxes) {

                const parentBox = box.closest(`:not(#${box.id}).${classes.Box}`);
                const parentOffset = parentBox ? parentBox.getBoundingClientRect().left : 0;
                const offset =parentBox ? box.getBoundingClientRect().left - parentOffset : 0;

                const breaks = box.querySelectorAll(`:scope > :not(.${classes.Box}):not(.${classes.Tag}):not(.${classes.Text})`);

                for(let br of breaks) {
                    const breakId = br.id;
                    if(displayState.breakIds.find(info => info.id === breakId)) { continue; }

                    const next = br.nextElementSibling;
                    if(next && next.getBoundingClientRect().right > containerWidth) {
                        // const offset = offsetLevel;
                        breakInfo = {id: breakId, offset: offset};
                        break;
                    }
                }

                if(breakInfo) {
                    break;
                }
            };

            if(breakInfo) {
                setDisplayState(ds => {
                    return {
                        ...ds,
                        breakIds: ds.breakIds.concat([breakInfo!])
                    };
                });
            }
        }
    };

    const computeNumBreaks = (pp: PpString, acc: number) : number => {
        switch(pp[0]) {
            case "Ppcmd_empty":
                return acc;
            case "Ppcmd_string":
                return acc;
            case "Ppcmd_glue":
                const nbBreaks = pp[1].map(pp => computeNumBreaks(pp, 0));
                const nb = nbBreaks.reduce((pv, cv) => {return pv + cv;}, 0);
                return acc + nb;
            case "Ppcmd_box":
            case "Ppcmd_tag":
                return computeNumBreaks(pp[2], acc);
            case "Ppcmd_print_break":
                return acc + 1;
            case "Ppcmd_force_newline":
                return acc;
            case "Ppcmd_comment":
                return acc;
        }
    };

    return (
        <div ref={container} className={classes.Container}>
            <span ref={content} className={classes.Content}>
                {
                    displayState.display ?
                    <PpBox
                        id={displayState.display.id}
                        coqCss={coqCss}
                        depth={0}
                        hide={false}
                        hovered={hovered}
                        maxDepth={maxDepth}
                        classList={[]}
                        mode={displayState.display.mode}
                        type={displayState.display.type}
                        boxChildren={displayState.display.boxChildren}
                        indent={displayState.display.indent}
                        breaks={displayState.breakIds}
                    />
                    : null
                }
            </span>
        </div>
    );

};


export default ppDisplay;